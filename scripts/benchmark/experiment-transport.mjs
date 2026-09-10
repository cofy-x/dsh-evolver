/** The only network boundary for the experience experiment; fixture mode uses the same adapter. */
import assert from 'node:assert/strict'
import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import { checkDestination } from '../runtime-e2e/budget.mjs'
import { response } from './transport.mjs'
import { ExperimentStop } from './experiment-ledger.mjs'

export function installExperimentTransport({
  live,
  ledger,
  runId,
  outputCap,
  fault,
  onWire,
  onStop,
  nextFixture,
  requestMs,
}) {
  const nativeFetch = globalThis.fetch,
    nativeTls = tls.connect
  let active,
    networkAttempts = 0
  const deny = () => {
    networkAttempts++
    onStop('forbidden-network')
    throw new ExperimentStop('forbidden-network')
  }
  const stop = (reason) => {
    onStop(reason)
    throw new ExperimentStop(reason)
  }
  globalThis.fetch = async (url, init) => {
    try {
      checkDestination(url, init)
    } catch {
      return deny()
    }
    try {
      active = ledger.reserve(runId, init.body, outputCap, Date.now(), requestMs)
    } catch (error) {
      return stop(error.reason ?? 'wire-validation')
    }
    process.send?.({ type: 'request-start', index: active.index, deadline: active.deadline })
    try {
      await onWire(JSON.parse(init.body), active)
      if (!live) {
        if (fault === 'rate-limit') {
          onStop('provider-http-429')
          return new Response('{}', { status: 429 })
        }
        if (fault === 'hang') return await new Promise(() => {})
        return response(nextFixture(), active.index + 1)
      }
      const remaining = active.deadline - Date.now()
      if (remaining <= 0) return stop('request-time-budget')
      const result = await nativeFetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([init.signal, AbortSignal.timeout(remaining)].filter(Boolean)),
      })
      if (!result.ok)
        onStop(
          result.status === 429
            ? 'provider-http-429'
            : result.status >= 500
              ? 'provider-http-5xx'
              : 'provider-http-4xx',
        )
      return result
    } catch (error) {
      onStop(
        error.reason ??
          (Date.now() >= active.deadline ? 'request-time-budget' : 'provider-transport'),
      )
      throw new ExperimentStop('provider-transport')
    }
  }
  if (!live) net.Socket.prototype.connect = deny
  tls.connect = live
    ? (options, ...args) => {
        if (options?.host !== 'api.deepseek.com' || Number(options.port) !== 443) return deny()
        return nativeTls(options, ...args)
      }
    : deny
  http.request = deny
  https.request = deny
  syncBuiltinESMExports()
  return {
    finish(usage, reason) {
      if (!active) return
      const index = active.index
      try {
        ledger.settle(index, usage, reason)
      } finally {
        process.send?.({ type: 'request-end', index })
        active = undefined
      }
    },
    assertOfflineBoundary() {
      assert.equal(networkAttempts, 0)
    },
  }
}
