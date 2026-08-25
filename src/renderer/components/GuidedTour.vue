<template>
  <teleport to="body">
    <!-- Overlay + spotlight: only visible once positioned -->
    <div v-if="active && positioned" class="fixed inset-0 z-[2000] pointer-events-none">
      <!-- Dark overlay with cutout -->
      <svg class="absolute inset-0 w-full h-full pointer-events-auto" @click="handleOverlayClick">
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              :x="spotlightRect.x - spotlightPadding"
              :y="spotlightRect.y - spotlightPadding"
              :width="spotlightRect.width + spotlightPadding * 2"
              :height="spotlightRect.height + spotlightPadding * 2"
              :rx="spotlightRadius"
              fill="black"
            />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#tour-mask)" />
      </svg>

      <!-- Spotlight border ring -->
      <div class="absolute pointer-events-none rounded-lg ring-2 ring-primary/80 transition-all duration-300"
        :style="{
          top: `${spotlightRect.y - spotlightPadding}px`,
          left: `${spotlightRect.x - spotlightPadding}px`,
          width: `${spotlightRect.width + spotlightPadding * 2}px`,
          height: `${spotlightRect.height + spotlightPadding * 2}px`,
        }"
      />
    </div>

    <!-- Popup: always in DOM when active (needed for popupRef), but invisible until positioned -->
    <div v-if="active" ref="popupRef" class="fixed pointer-events-auto z-[2001]"
      :style="{ top: popupPos.top, left: popupPos.left, visibility: positioned ? 'visible' : 'hidden' }">
      <div class="flex items-start text-left bg-slate-800/95 text-white p-5 min-h-[80px] rounded-md shadow-lg max-w-[500px]"
        @click.stop>
          <!-- Arrow -->
          <div class="absolute w-0 h-0 border-l-[10px] border-r-[10px] border-transparent"
            :class="{
              'border-b-[10px] border-b-slate-800/95 -top-[10px]': popupPlacement === 'bottom',
              'border-t-[10px] border-t-slate-800/95 -bottom-[10px]': popupPlacement === 'top',
            }"
            :style="{ left: `${arrowX}px`, transform: 'translateX(-50%)' }"
          />

          <img src="../assets/houston.png" alt="Houston"
            class="w-16 h-16 mr-3 rounded-lg object-cover flex-shrink-0" />
          <div class="flex flex-col flex-1 min-w-0">
            <p class="font-mono text-xs text-muted mb-1"><i>Houston Commander says:</i></p>
            <p class="font-mono text-sm whitespace-pre-wrap break-words">{{ currentStep?.message }}</p>

            <!-- Navigation -->
            <div class="flex items-center justify-between mt-3 pt-2 border-t border-white/20">
              <span class="text-xs text-muted">{{ currentIndex + 1 }} / {{ steps.length }}</span>
              <div class="flex items-center gap-2">
                <button class="text-xs text-muted hover:text-white underline" @click="skip">Skip tour</button>
                <button v-if="currentIndex > 0"
                  class="px-3 py-1 text-xs rounded bg-white/10 hover:bg-white/20 transition-colors"
                  @click="prev">Back</button>
                <button
                  class="px-3 py-1 text-xs rounded bg-primary text-white hover:bg-primary/80 transition-colors"
                  @click="next">
                  {{ currentIndex === steps.length - 1 ? 'Finish' : 'Next' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { computePosition, offset, flip, shift } from '@floating-ui/dom';
import type { TourStep } from '../composables/useTourManager';
export type { TourStep };

const props = defineProps<{
  steps: TourStep[];
  active: boolean;
}>();

const emit = defineEmits<{
  done: [];
  skip: [];
}>();

const currentIndex = ref(0);
const popupRef = ref<HTMLElement | null>(null);
const positioned = ref(false);
const spotlightPadding = 8;
const spotlightRadius = 8;

const currentStep = computed(() => props.steps[currentIndex.value]);

const spotlightRect = ref({ x: 0, y: 0, width: 0, height: 0 });
const popupPos = ref({ top: '0px', left: '0px' });
const popupPlacement = ref<'top' | 'bottom'>('bottom');
const arrowX = ref(0);

// Track the polling timer so we can cancel it on cleanup / step change
let pollHandle: number | null = null;
// Guard against re-scrolling every frame — a target taller than the viewport
// can never satisfy scrollIntoView, which would loop and trap the scrollbar.
let scrolledForStep = false;
// Direction of travel, so a skipped step keeps moving the way the user was going.
let stepDirection = 1;

function cancelPoll() {
  if (pollHandle != null) {
    cancelAnimationFrame(pollHandle);
    pollHandle = null;
  }
}

function getTargetEl(): HTMLElement | null {
  if (!currentStep.value) return null;
  return document.querySelector(currentStep.value.target);
}

/**
 * Position the popup relative to the current step's target element.
 * If the target or popupRef isn't in the DOM yet, poll via rAF
 * for up to ~2 seconds before falling back to a centered position.
 */
function positionPopup(startTime?: number) {
  cancelPoll();
  const now = startTime ?? performance.now();

  const el = getTargetEl();
  const popup = popupRef.value;

  // Target element or popup div not in DOM yet — retry via rAF
  if (!el || !popup) {
    const elapsed = performance.now() - now;
    if (elapsed < 2000) {
      pollHandle = requestAnimationFrame(() => positionPopup(now));
      return;
    }
    // Target never appeared (conditional UI, different app state) — skip the
    // step rather than spotlighting empty space.
    skipMissingStep();
    return;
  }

  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fitsInViewport = rect.height <= vh - 32;

  // Bring offscreen targets into view, then re-measure on the next frame.
  const needsScroll = fitsInViewport
    ? rect.top < 0 || rect.bottom > vh
    : rect.top > vh - 80 || rect.bottom < 80;

  if (needsScroll && !scrolledForStep) {
    scrolledForStep = true;
    el.scrollIntoView({ block: fitsInViewport ? 'center' : 'start', behavior: 'auto' });
    pollHandle = requestAnimationFrame(() => positionPopup(performance.now()));
    return;
  }

  // Clamp to the viewport so oversized targets still spotlight and anchor sanely.
  const left = Math.max(rect.left, 8);
  const top = Math.max(rect.top, 8);
  const right = Math.max(Math.min(rect.right, vw - 8), left + 1);
  const bottom = Math.max(Math.min(rect.bottom, vh - 8), top + 1);
  const visible = {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };

  spotlightRect.value = {
    x: visible.x,
    y: visible.y,
    width: visible.width,
    height: visible.height,
  };

  const preferred = currentStep.value?.placement ?? 'bottom';
  const reference = { getBoundingClientRect: () => ({ ...visible, toJSON: () => visible }) };
  computePosition(reference, popup, {
    strategy: 'fixed',
    placement: preferred,
    middleware: [
      offset(16),
      flip({ fallbackPlacements: ['top', 'bottom'] }),
      shift({ padding: 12, crossAxis: true }),
    ],
  }).then(({ x, y, placement }) => {
    popupPlacement.value = placement.startsWith('top') ? 'top' : 'bottom';
    popupPos.value = { top: `${y}px`, left: `${x}px` };

    // Calculate arrow position pointing at center of target
    const targetCenterX = visible.x + visible.width / 2;
    arrowX.value = Math.max(20, Math.min(targetCenterX - x, (popup.offsetWidth ?? 400) - 20));
    positioned.value = true;
  });
}

/** Reset internal state and start positioning for a fresh tour / step. */
function startPositioning() {
  positioned.value = false;
  scrolledForStep = false;
  cancelPoll();
  // Let the step prepare its target (switch tabs, expand panels, …) before we look for it.
  Promise.resolve(currentStep.value?.onEnter?.()).finally(() => {
    // Wait one tick so Vue can flush DOM updates (v-if toggle, new route view mount)
    nextTick(() => positionPopup());
  });
}

function next() {
  stepDirection = 1;
  if (currentIndex.value >= props.steps.length - 1) {
    emit('done');
  } else {
    currentIndex.value++;
  }
}

function prev() {
  stepDirection = -1;
  if (currentIndex.value > 0) currentIndex.value--;
}

/** Move past a step whose target never rendered, continuing in the direction of travel. */
function skipMissingStep() {
  const target = currentIndex.value + (stepDirection >= 0 ? 1 : -1);
  if (target >= 0 && target < props.steps.length) {
    currentIndex.value = target;
    return;
  }
  if (stepDirection < 0 && currentIndex.value + 1 < props.steps.length) {
    stepDirection = 1;
    currentIndex.value++;
    return;
  }
  emit('done');
}

function skip() {
  emit('skip');
}

function handleOverlayClick() {
  next();
}

// Reposition on step change (next/prev)
watch(currentIndex, () => {
  startPositioning();
});

// Reposition when activation toggles on
watch(() => props.active, (isActive) => {
  if (isActive) {
    currentIndex.value = 0;
    stepDirection = 1;
    startPositioning();
  } else {
    cancelPoll();
    positioned.value = false;
  }
});

// Detect the tour manager swapping to a different tour (steps array changes while active stays true)
watch(() => props.steps, () => {
  if (props.active) {
    currentIndex.value = 0;
    stepDirection = 1;
    startPositioning();
  }
});

// Handle window resize
function onResize() {
  if (props.active && positioned.value) positionPopup();
}

onMounted(() => {
  window.addEventListener('resize', onResize);
  // Kick off initial positioning if already active on mount
  // (happens when parent uses v-if to mount us with :active="true")
  if (props.active) {
    currentIndex.value = 0;
    stepDirection = 1;
    startPositioning();
  }
});
onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  cancelPoll();
});
</script>
