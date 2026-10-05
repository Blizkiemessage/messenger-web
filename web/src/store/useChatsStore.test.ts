import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * loadChats coalescing (2026-10-05). On startup the chats list was requested
 * three times within ~100 ms (login effect, socket 'connect', session refresh).
 * Against the remote API every duplicate is a full round trip, so concurrent
 * calls must share one request and a just-loaded list must be reused — while
 * `force` (account switch, message from an unknown chat) always refetches.
 */

const getChats = vi.fn();
vi.mock('../api/chats', () => ({ getChats: (...args: unknown[]) => getChats(...args) }));

// Fresh module per test: the coalescing state lives at module level.
async function loadStore() {
  vi.resetModules();
  return (await import('./useChatsStore')).useChatsStore;
}

beforeEach(() => {
  getChats.mockReset();
  getChats.mockResolvedValue([]);
  vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useChatsStore.loadChats — coalescing', () => {
  it('concurrent calls share a single request', async () => {
    const store = await loadStore();
    const { loadChats } = store.getState();
    await Promise.all([loadChats(), loadChats(), loadChats()]);
    expect(getChats).toHaveBeenCalledTimes(1);
  });

  it('a list loaded moments ago is reused, and refetched once it is stale', async () => {
    const store = await loadStore();
    await store.getState().loadChats();
    await store.getState().loadChats();
    expect(getChats).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 3001);
    await store.getState().loadChats();
    expect(getChats).toHaveBeenCalledTimes(2);
  });

  it('force always refetches, even right after a load', async () => {
    const store = await loadStore();
    await store.getState().loadChats();
    await store.getState().loadChats({ force: true });
    expect(getChats).toHaveBeenCalledTimes(2);
  });

  it('a failed load does not count as fresh, so the next call retries', async () => {
    const store = await loadStore();
    getChats.mockRejectedValueOnce(Object.assign(new Error('Server error'), { status: 500 }));
    await store.getState().loadChats();
    expect(store.getState().dataError).toBe('Server error');

    await store.getState().loadChats();
    expect(getChats).toHaveBeenCalledTimes(2);
    expect(store.getState().dataError).toBeNull();
  });
});
