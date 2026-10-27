import { describe, expect, it } from 'vitest';
import { assertAutomationMediaPermission, type AutomationMediaPermission } from './pipeline.js';

const active: AutomationMediaPermission = { parentStatus: 'WAITING_PRODUCTION', controlStatus: 'ACTIVE', reservationStatus: 'ACTIVE', reservedUsd: 0.1, requiredUsd: 0.1, paidProvider: false };

describe('media worker Autopilot action guard', () => {
  it('prevents the next action after emergency stop, cancellation or pause', () => {
    expect(() => assertAutomationMediaPermission(active)).not.toThrow();
    expect(() => assertAutomationMediaPermission({ ...active, controlStatus: 'STOPPED' })).toThrow('AUTOMATION_CANCELLED');
    expect(() => assertAutomationMediaPermission({ ...active, parentStatus: 'CANCELLED' })).toThrow('AUTOMATION_CANCELLED');
    expect(() => assertAutomationMediaPermission({ ...active, controlStatus: 'PAUSED' })).toThrow('AUTOMATION_PAUSED');
  });
  it('requires an active reservation and refuses paid providers without a reliable cost bound', () => {
    expect(() => assertAutomationMediaPermission({ ...active, reservationStatus: 'RELEASED' })).toThrow('AUTOMATION_BUDGET_RESERVATION_REQUIRED');
    expect(() => assertAutomationMediaPermission({ ...active, reservedUsd: 0.09 })).toThrow('AUTOMATION_BUDGET_RESERVATION_REQUIRED');
    expect(() => assertAutomationMediaPermission({ ...active, paidProvider: true })).toThrow('PAID_PROVIDER_BUDGET_UNBOUNDED');
  });
});
