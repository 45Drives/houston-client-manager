import { ref, readonly, type Ref } from 'vue';
import { useSettings } from './useSettings';

export interface TourStep {
  /** CSS selector for the target element to highlight */
  target: string;
  /** Message to display in the Commander popup */
  message: string;
  /** Preferred popup placement relative to target */
  placement?: 'top' | 'bottom';
  /** Runs before the step is positioned — use to switch tabs/expand panels so the target exists. */
  onEnter?: () => void | Promise<void>;
}

export interface TourRegistration {
  id: string;
  steps: TourStep[];
  onDone: () => void | Promise<void>;
}

const _activeTour = ref<TourRegistration | null>(null);
const _queue: TourRegistration[] = [];

/**
 * Centralized tour manager — guarantees only one GuidedTour is active at a time.
 *
 * Components call `requestTour(id, steps, onDone)` when they want to show a tour.
 * If no tour is active, it starts immediately. Otherwise it queues behind the current one.
 *
 * `finishTour()` is called by the single GuidedTour instance (mounted in AppShell)
 * when the user finishes or skips the active tour.
 */
export function useTourManager() {
  const { settings } = useSettings();

  /** Request a tour. Starts immediately if nothing else is active, otherwise queues. */
  function requestTour(id: string, steps: TourStep[], onDone: () => void | Promise<void>) {
    // Skip if guided tours are disabled
    if (settings.value?.guidedToursEnabled === false) return;
    // Don't double-register the same tour
    if (_activeTour.value?.id === id || _queue.some(t => t.id === id)) return;

    const registration: TourRegistration = { id, steps, onDone };
    if (!_activeTour.value) {
      _activeTour.value = registration;
    } else {
      _queue.push(registration);
    }
  }

  /** Cancel a queued (not yet active) tour by id. */
  function cancelTour(id: string) {
    const idx = _queue.findIndex(t => t.id === id);
    if (idx !== -1) _queue.splice(idx, 1);
    // If the active tour is being cancelled, finish it
    if (_activeTour.value?.id === id) {
      _activeTour.value = null;
      advanceQueue();
    }
  }

  /** Called when the active tour completes (done or skip). */
  async function finishTour() {
    if (_activeTour.value) {
      await _activeTour.value.onDone();
      _activeTour.value = null;
    }
    advanceQueue();
  }

  function advanceQueue() {
    if (_queue.length > 0 && !_activeTour.value) {
      _activeTour.value = _queue.shift()!;
    }
  }

  return {
    /** The currently-active tour (null if none). Read-only. */
    activeTour: readonly(_activeTour) as Readonly<Ref<TourRegistration | null>>,
    requestTour,
    cancelTour,
    finishTour,
  };
}
