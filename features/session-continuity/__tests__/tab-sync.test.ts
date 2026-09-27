import { createSessionSyncMessage } from '../tab-sync';

describe('session tab synchronization', () => {
  it('creates typed cross-tab events', () => {
    const message = createSessionSyncMessage('WALLET_DISCONNECTED', { reason: 'logout' }, 'tab-a');
    expect(message.event).toBe('WALLET_DISCONNECTED');
    expect(message.source).toBe('tab-a');
    expect(message.timestamp).toEqual(expect.any(Number));
  });
});
