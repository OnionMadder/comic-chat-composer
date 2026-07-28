import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isMessageEvent, isPresenceEvent } from '../src/types.ts';
import type { ChatEvent } from '../src/types.ts';

// One event of each type in the union. The guards exist because both union
// members carry a two-literal `type`, which defeats plain narrowing — so the
// guards themselves must classify all four correctly.
const message: ChatEvent = { type: 'message', author: 'alice', text: 'hi', at: 0 };
const action: ChatEvent = { type: 'action', author: 'alice', text: 'waves', at: 1 };
const join: ChatEvent = { type: 'join', author: 'bob', at: 2 };
const leave: ChatEvent = { type: 'leave', author: 'bob', at: 3 };

describe('isMessageEvent', () => {
  it('accepts messages and actions', () => {
    assert.equal(isMessageEvent(message), true);
    assert.equal(isMessageEvent(action), true);
  });

  it('rejects presence events', () => {
    assert.equal(isMessageEvent(join), false);
    assert.equal(isMessageEvent(leave), false);
  });
});

describe('isPresenceEvent', () => {
  it('accepts joins and leaves', () => {
    assert.equal(isPresenceEvent(join), true);
    assert.equal(isPresenceEvent(leave), true);
  });

  it('rejects messages and actions', () => {
    assert.equal(isPresenceEvent(message), false);
    assert.equal(isPresenceEvent(action), false);
  });
});
