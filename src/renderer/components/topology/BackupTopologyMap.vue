<template>
  <div class="bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 overflow-hidden">
    <div class="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between gap-2">
      <div>
        <h3 class="text-sm font-semibold text-default flex items-center gap-1.5">
          Backup Network Topology
          <CommanderToolTip :message="`This map shows where your data actually goes.

Each box is a node: this client, a server on your network, a server at another site, or a cloud remote. Each line is a real backup relationship read from the servers themselves — ZFS replication, file copies, and cloud sync jobs.

Dashed lines mean the link travels over a WireShield VPN tunnel, which is how off-site backups reach a server outside your local network.

Use it to spot servers with nothing backing them up, and to confirm that off-site copies exist before you need them. Refresh re-probes every saved server.`" />
        </h3>
        <p class="text-xs text-gray-400">
          Client, local servers, remote replication targets, and cloud remotes.
        </p>
      </div>
      <button class="btn btn-sm btn-secondary h-fit" :disabled="loading" @click="refresh">
        {{ loading ? 'Refreshing...' : 'Refresh' }}
      </button>
    </div>

    <div class="px-4 py-3 space-y-3">
      <div class="flex flex-wrap gap-2 text-xs">
        <span class="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          Local servers: {{ stats.localServers }}
        </span>
        <span class="px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300">
          Remote servers: {{ stats.remoteServers }}
        </span>
        <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
          Cloud remotes: {{ stats.cloudTargets }}
        </span>
        <span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          Local pool-to-pool: {{ stats.localPoolToPool }}
        </span>
      </div>

      <div v-if="error" class="text-xs text-red-500">{{ error }}</div>

      <div v-else-if="!hasGraph" class="text-xs text-gray-400 py-4">
        No topology links were found yet.
      </div>

      <div v-else class="relative rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/30 p-2">
        <div class="absolute right-3 top-3 z-10 flex items-center gap-1">
          <button class="btn btn-sm btn-secondary h-fit px-2" title="Zoom out" @click="zoomBy(1 / 1.2)">-</button>
          <span class="text-[11px] text-gray-400 w-10 text-center">{{ Math.round(zoom * 100) }}%</span>
          <button class="btn btn-sm btn-secondary h-fit px-2" title="Zoom in" @click="zoomBy(1.2)">+</button>
          <button class="btn btn-sm btn-secondary h-fit px-2" title="Reset view" @click="resetView">Reset</button>
        </div>

        <svg
          ref="svgEl"
          class="w-full h-[430px] select-none"
          :class="panning ? 'cursor-grabbing' : 'cursor-grab'"
          viewBox="0 0 1000 480"
          preserveAspectRatio="xMidYMid meet"
          @wheel="onWheel"
          @mousedown="onPanStart"
          @mousemove="onPanMove"
          @mouseup="onPanEnd"
          @mouseleave="onPanEnd"
        >
          <defs>
            <marker id="topology-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280" />
            </marker>
          </defs>

          <g :transform="`translate(${panX}, ${panY}) scale(${zoom})`">
            <text x="500" y="22" text-anchor="middle" class="lane-label">Desktop Client</text>
            <text x="500" y="126" text-anchor="middle" class="lane-label">Local Backup Servers</text>
            <text x="250" y="290" text-anchor="middle" class="lane-label">Remote Servers</text>
            <text x="750" y="290" text-anchor="middle" class="lane-label">Cloud Targets</text>

            <g v-for="line in svgLines" :key="line.id">
              <line
                :x1="line.x1"
                :y1="line.y1"
                :x2="line.x2"
                :y2="line.y2"
                :stroke="line.color"
                stroke-width="2"
                marker-end="url(#topology-arrow)"
                stroke-linecap="round"
              />
              <text :x="line.labelX" :y="line.labelY" text-anchor="middle" class="edge-label" :fill="line.color">
                {{ line.label }}
              </text>
            </g>

            <g v-for="node in positionedNodes" :key="node.id">
              <rect
                :x="node.x - 80"
                :y="node.y - 20"
                rx="8"
                ry="8"
                width="160"
                height="40"
                :fill="node.fill"
                :stroke="node.stroke"
                stroke-width="1.25"
              />
              <text :x="node.x" :y="node.y - 4" text-anchor="middle" class="node-label">
                {{ node.label }}
              </text>
              <text v-if="node.subLabel" :x="node.x" :y="node.y + 11" text-anchor="middle" class="node-sub-label">
                {{ node.subLabel }}
              </text>
            </g>
          </g>
        </svg>

        <div class="mt-1 text-[11px] text-gray-400">Ctrl + scroll to zoom, drag to pan.</div>
      </div>

      <div v-if="graph.localPoolToPoolDetails.length" class="space-y-1.5">
        <div class="text-xs font-semibold text-default">Local pool-to-pool tasks</div>
        <div class="max-h-28 overflow-auto space-y-1">
          <div v-for="item in graph.localPoolToPoolDetails" :key="`${item.serverHost}:${item.taskName}`"
            class="text-xs bg-neutral-50 dark:bg-neutral-900/40 rounded px-2 py-1 border border-neutral-200 dark:border-neutral-700">
            {{ item.serverHost }} :: {{ item.taskName }} ({{ item.sourceDataset }} -> {{ item.destDataset }})
          </div>
        </div>
      </div>

      <div v-if="lastUpdatedAt" class="text-[11px] text-gray-400">
        Last updated: {{ new Date(lastUpdatedAt).toLocaleTimeString() }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useBackupTopology } from '../../composables/useBackupTopology'
import { CommanderToolTip } from '../commander'

const props = defineProps<{ serverHost?: string }>()

const VIEW_W = 1000
const VIEW_H = 480

const svgEl = ref<SVGSVGElement | null>(null)
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const panning = ref(false)
let lastPointer = { x: 0, y: 0 }

/** Convert a mouse event to viewBox coordinates. */
function toViewBox(e: MouseEvent): { x: number; y: number } {
  const rect = svgEl.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return {
    x: ((e.clientX - rect.left) / rect.width) * VIEW_W,
    y: ((e.clientY - rect.top) / rect.height) * VIEW_H,
  }
}

function applyZoom(next: number, anchorX: number, anchorY: number) {
  const clamped = Math.min(3, Math.max(0.4, next))
  // Keep the anchor point stationary while scaling.
  panX.value = anchorX - ((anchorX - panX.value) / zoom.value) * clamped
  panY.value = anchorY - ((anchorY - panY.value) / zoom.value) * clamped
  zoom.value = clamped
}

function zoomBy(factor: number) {
  applyZoom(zoom.value * factor, VIEW_W / 2, VIEW_H / 2)
}

function resetView() {
  zoom.value = 1
  panX.value = 0
  panY.value = 0
}

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey) return
  e.preventDefault()
  const point = toViewBox(e)
  applyZoom(zoom.value * (e.deltaY < 0 ? 1.12 : 1 / 1.12), point.x, point.y)
}

function onPanStart(e: MouseEvent) {
  panning.value = true
  lastPointer = toViewBox(e)
}

function onPanMove(e: MouseEvent) {
  if (!panning.value) return
  const point = toViewBox(e)
  panX.value += point.x - lastPointer.x
  panY.value += point.y - lastPointer.y
  lastPointer = point
}

function onPanEnd() {
  panning.value = false
}

const { graph, stats, loading, error, lastUpdatedAt, refresh } = useBackupTopology({
  onlyServerHost: props.serverHost,
})

const hasGraph = computed(() => graph.value.nodes.length > 0 && graph.value.edges.length > 0)

const laneY = {
  client: 58,
  local: 170,
  remote: 334,
  cloud: 334,
}

const nodeColors: Record<string, { fill: string; stroke: string }> = {
  client: { fill: '#dbeafe', stroke: '#3b82f6' },
  'local-server': { fill: '#d1fae5', stroke: '#10b981' },
  'remote-server': { fill: '#cffafe', stroke: '#06b6d4' },
  cloud: { fill: '#ede9fe', stroke: '#8b5cf6' },
}

const positionedNodes = computed(() => {
  const clientNodes = graph.value.nodes.filter(n => n.kind === 'client')
  const localNodes = graph.value.nodes.filter(n => n.kind === 'local-server')
  const remoteNodes = graph.value.nodes.filter(n => n.kind === 'remote-server')
  const cloudNodes = graph.value.nodes.filter(n => n.kind === 'cloud')

  const out: Array<{
    id: string
    x: number
    y: number
    label: string
    subLabel?: string
    fill: string
    stroke: string
  }> = []

  function spreadX(index: number, total: number, min: number, max: number): number {
    if (total <= 1) return (min + max) / 2
    const step = (max - min) / (total - 1)
    return min + index * step
  }

  /** Lay a lane out in rows of at most `perRow` so wide boxes never overlap. */
  function gridPos(index: number, total: number, min: number, max: number, baseY: number, perRow: number) {
    const rows = Math.ceil(total / perRow)
    const row = Math.floor(index / perRow)
    const inRow = index % perRow
    const countInRow = row === rows - 1 ? total - row * perRow : perRow
    return { x: spreadX(inRow, countInRow, min, max), y: baseY + row * 52 }
  }

  function truncate(value: string, max = 22): string {
    return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value
  }

  clientNodes.forEach((n, i) => {
    const c = nodeColors[n.kind]
    out.push({
      id: n.id,
      x: spreadX(i, clientNodes.length, 420, 580),
      y: laneY.client,
      label: n.label,
      fill: c.fill,
      stroke: c.stroke,
    })
  })

  localNodes.forEach((n, i) => {
    const c = nodeColors[n.kind]
    const bits: string[] = []
    if (n.localPoolToPoolCount) bits.push(`P2P:${n.localPoolToPoolCount}`)
    if (n.unreachable) bits.push('offline')
    if (!bits.length && n.meta) bits.push(n.meta)
    out.push({
      id: n.id,
      x: spreadX(i, localNodes.length, 150, 850),
      y: laneY.local,
      label: truncate(n.label),
      subLabel: bits.length ? truncate(bits.join(' | '), 26) : undefined,
      fill: n.unreachable ? '#fee2e2' : c.fill,
      stroke: n.unreachable ? '#ef4444' : c.stroke,
    })
  })

  remoteNodes.forEach((n, i) => {
    const c = nodeColors[n.kind]
    const pos = gridPos(i, remoteNodes.length, 100, 400, laneY.remote, 2)
    out.push({
      id: n.id,
      x: pos.x,
      y: pos.y,
      label: truncate(n.label),
      subLabel: n.meta ? truncate(n.meta, 26) : undefined,
      fill: c.fill,
      stroke: c.stroke,
    })
  })

  cloudNodes.forEach((n, i) => {
    const c = nodeColors[n.kind]
    const pos = gridPos(i, cloudNodes.length, 600, 900, laneY.cloud, 2)
    out.push({
      id: n.id,
      x: pos.x,
      y: pos.y,
      label: truncate(n.label),
      subLabel: n.meta ? truncate(n.meta, 26) : undefined,
      fill: c.fill,
      stroke: c.stroke,
    })
  })

  return out
})

const nodeById = computed(() => {
  const map = new Map<string, { x: number; y: number }>()
  for (const n of positionedNodes.value) map.set(n.id, { x: n.x, y: n.y })
  return map
})

const edgeColor = (kind: string) => {
  if (kind === 'client-backup') return '#3b82f6'
  if (kind === 'rsync') return '#0891b2'
  if (kind === 'zfs-remote') return '#10b981'
  return '#8b5cf6'
}

const NODE_HALF_W = 80
const NODE_HALF_H = 20

const svgLines = computed(() => {
  // Parallel edges between the same pair get stacked instead of overlapping.
  const pairTotals = new Map<string, number>()
  for (const e of graph.value.edges) {
    const key = [e.from, e.to].sort().join('|')
    pairTotals.set(key, (pairTotals.get(key) ?? 0) + 1)
  }
  const pairIndex = new Map<string, number>()

  return graph.value.edges
    .map(e => {
      const from = nodeById.value.get(e.from)
      const to = nodeById.value.get(e.to)
      if (!from || !to) return null

      const pairKey = [e.from, e.to].sort().join('|')
      const slot = pairIndex.get(pairKey) ?? 0
      const pairTotal = pairTotals.get(pairKey) ?? 1
      pairIndex.set(pairKey, slot + 1)

      const color = edgeColor(e.kind)
      const label = e.viaWireGuard ? `${e.label} (WireGuard)` : e.label

      const sameLane = Math.abs(from.y - to.y) < 1
      if (sameLane) {
        // Route edge-to-edge horizontally so opposite directions run parallel.
        const goingRight = from.x < to.x
        const laneOffset = pairTotal === 1
          ? 0
          : (slot % 2 === 0 ? -1 : 1) * (18 + Math.floor(slot / 2) * 20)
        const y = from.y + laneOffset
        const x1 = goingRight ? from.x + NODE_HALF_W : from.x - NODE_HALF_W
        const x2 = goingRight ? to.x - NODE_HALF_W : to.x + NODE_HALF_W
        return {
          id: e.id,
          x1,
          y1: y,
          x2,
          y2: y,
          label,
          labelX: (x1 + x2) / 2,
          labelY: laneOffset > 0 ? y + 16 : y - 8,
          color,
        }
      }

      const goingDown = from.y < to.y
      const shift = pairTotal === 1
        ? 0
        : (slot % 2 === 0 ? -1 : 1) * Math.ceil((slot + 1) / 2) * 32
      // Stagger labels along the line so stacked edges do not print on top of each other.
      const t = 0.5 + (slot % 3) * 0.12
      return {
        id: e.id,
        x1: from.x + shift,
        y1: goingDown ? from.y + NODE_HALF_H : from.y - NODE_HALF_H,
        x2: to.x + shift,
        y2: goingDown ? to.y - NODE_HALF_H : to.y + NODE_HALF_H,
        label,
        labelX: from.x + (to.x - from.x) * t + shift,
        labelY: from.y + (to.y - from.y) * t - 8,
        color,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
})

onMounted(() => {
  refresh()
})

watch(() => props.serverHost, () => refresh())
</script>

<style scoped>
.node-label {
  font-size: 11px;
  fill: #111827;
  font-weight: 600;
}

.node-sub-label {
  font-size: 10px;
  fill: #4b5563;
}

.edge-label {
  font-size: 10px;
  font-weight: 600;
  /* Halo keeps labels readable where they cross an edge. */
  paint-order: stroke;
  stroke: #ffffff;
  stroke-width: 3px;
  stroke-linejoin: round;
}

.lane-label {
  font-size: 11px;
  fill: #6b7280;
  font-weight: 600;
}
</style>
