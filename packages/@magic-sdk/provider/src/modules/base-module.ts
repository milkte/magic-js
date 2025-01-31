import { JsonRpcRequestPayload, MagicOutgoingWindowMessage, MagicIncomingWindowMessage } from '@magic-sdk/types';
import { createMalformedResponseError, MagicRPCError } from '../core/sdk-exceptions';
import type { SDKBase } from '../core/sdk';
import { standardizeJsonRpcRequestPayload } from '../core/json-rpc';
import { createPromiEvent } from '../util/promise-tools';
import type { ViewController } from '../core/view-controller';
import type { EventsDefinition } from '../util/events';

export class BaseModule {
  constructor(protected sdk: SDKBase) {}

  /**
   * The `ViewController` for the SDK instance registered to this module.
   */
  protected get overlay(): ViewController {
    return (this.sdk as any).overlay;
  }

  /**
   * Emits promisified requests to the Magic `<iframe>` context.
   */
  protected request<ResultType = any, Events extends EventsDefinition = void>(payload: Partial<JsonRpcRequestPayload>) {
    const responsePromise = this.overlay.post<ResultType>(
      MagicOutgoingWindowMessage.MAGIC_HANDLE_REQUEST,
      standardizeJsonRpcRequestPayload(payload),
    );

    // PromiEvent-ify the response.
    const promiEvent = createPromiEvent<ResultType, Events>((resolve, reject) => {
      responsePromise
        .then((res) => {
          cleanupEvents();
          if (res.hasError) reject(new MagicRPCError(res.payload.error));
          else if (res.hasResult) resolve(res.payload.result as ResultType);
          else throw createMalformedResponseError();
        })
        .catch((err) => {
          cleanupEvents();
          reject(err);
        });
    });

    // Listen for events from the `<iframe>` associated with the current payload
    // and emit those to `PromiEvent` subscribers.
    const cleanupEvents = this.overlay.on(MagicIncomingWindowMessage.MAGIC_HANDLE_EVENT, (evt) => {
      const { response } = evt.data;

      if (response.id === payload.id && response.result?.event) {
        const { event, params = [] } = response.result;
        promiEvent.emit(event, ...params);
      }
    });

    return promiEvent;
  }
}
