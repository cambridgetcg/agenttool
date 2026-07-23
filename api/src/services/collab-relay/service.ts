/** Injectable collaboration relay service.
 *
 * Routes depend on this interface rather than the database singleton so
 * protocol/auth tests remain hermetic. The production store uses Postgres as
 * the clock, serialization boundary, and durable replay authority.
 * Doctrine: docs/CROSS-DEVICE-COLLABORATION.md. */

import type {
  CollabEnrolmentInput,
  CollabEventPage,
  CollabPrincipal,
  EnrolmentResult,
  ListOperationsInput,
  ListPageInput,
  OperationBeginInput,
  OperationClaimInput,
  OperationCompleteInput,
  OperationPage,
  OperationRecoverInput,
  OperationReleaseInput,
  OperationRenewInput,
  OperationResult,
  ProviderObservationInput,
  ProviderObservationPage,
  ProviderObservationResult,
} from "./contracts";

export interface CollabRelayStore {
  enrol(projectId: string, input: CollabEnrolmentInput): Promise<EnrolmentResult>;
  authenticate(
    rawToken: string,
    options?: { record_usage?: boolean },
  ): Promise<CollabPrincipal | null>;
  listEvents(
    principal: CollabPrincipal,
    input: ListPageInput,
  ): Promise<CollabEventPage>;
  listOperations(
    principal: CollabPrincipal,
    input: ListOperationsInput,
  ): Promise<OperationPage>;
  claim(
    principal: CollabPrincipal,
    input: OperationClaimInput,
  ): Promise<OperationResult>;
  renew(
    principal: CollabPrincipal,
    input: OperationRenewInput,
  ): Promise<OperationResult>;
  begin(
    principal: CollabPrincipal,
    input: OperationBeginInput,
  ): Promise<OperationResult>;
  complete(
    principal: CollabPrincipal,
    input: OperationCompleteInput,
  ): Promise<OperationResult>;
  release(
    principal: CollabPrincipal,
    input: OperationReleaseInput,
  ): Promise<OperationResult>;
  recover(
    principal: CollabPrincipal,
    input: OperationRecoverInput,
  ): Promise<OperationResult>;
  importObservation(
    principal: CollabPrincipal,
    input: ProviderObservationInput,
  ): Promise<ProviderObservationResult>;
  listObservations(
    principal: CollabPrincipal,
    input: ListPageInput,
  ): Promise<ProviderObservationPage>;
}

export interface CollabRelayService extends CollabRelayStore {}

export function createCollabRelayService(
  store: CollabRelayStore,
): CollabRelayService {
  return {
    enrol: (projectId, input) => store.enrol(projectId, input),
    authenticate: (rawToken, options) => store.authenticate(rawToken, options),
    listEvents: (principal, input) => store.listEvents(principal, input),
    listOperations: (principal, input) =>
      store.listOperations(principal, input),
    claim: (principal, input) => store.claim(principal, input),
    renew: (principal, input) => store.renew(principal, input),
    begin: (principal, input) => store.begin(principal, input),
    complete: (principal, input) => store.complete(principal, input),
    release: (principal, input) => store.release(principal, input),
    recover: (principal, input) => store.recover(principal, input),
    importObservation: (principal, input) =>
      store.importObservation(principal, input),
    listObservations: (principal, input) =>
      store.listObservations(principal, input),
  };
}
