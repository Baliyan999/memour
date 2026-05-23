<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { motion, useScroll, useTransform, useReducedMotion, useMotionValue, useSpring } from 'motion-v'
import { useMouse, useWindowSize } from '@vueuse/core'

/**
 * GlobalBackground — single fixed-position canvas behind every page.
 * Stacked layers (back→front): conic gradient mesh, aurora orbs (×6),
 * light rays (×4), drifting particles, scroll-driven hue veil,
 * parallax stars (×35 in 2 depth layers), cursor halo + 3-dot trail,
 * corner vignette. Lives at z-index:-10, pointer-events:none.
 */
const reduce = useReducedMotion()
const { scrollYProgress } = useScroll()
const mounted = ref(false)
onMounted(() => { mounted.value = true })

const { x: mx, y: my } = useMouse({ touch: false })
const { width: vw, height: vh } = useWindowSize()

// Mouse-tied springs for halo + trail at different lag.
const mxv = useMotionValue(0)
const myv = useMotionValue(0)
function syncMouse() {
  mxv.set(mx.value)
  myv.set(my.value)
}
// Use a small effect to push updates from useMouse refs into motion values.
let raf = 0
function tick() {
  syncMouse()
  raf = requestAnimationFrame(tick)
}
onMounted(() => {
  if (!reduce.value) raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

const haloX = useSpring(mxv, { stiffness: 40, damping: 22, mass: 1.2 })
const haloY = useSpring(myv, { stiffness: 40, damping: 22, mass: 1.2 })
const trail1X = useSpring(mxv, { stiffness: 80, damping: 25, mass: 1 })
const trail1Y = useSpring(myv, { stiffness: 80, damping: 25, mass: 1 })
const trail2X = useSpring(mxv, { stiffness: 50, damping: 22, mass: 1.1 })
const trail2Y = useSpring(myv, { stiffness: 50, damping: 22, mass: 1.1 })

// Scroll-driven orbs Y translation
const orb1Y = useTransform(scrollYProgress, [0, 1], [0, 320])
const orb2Y = useTransform(scrollYProgress, [0, 1], [0, -240])
const orb3Y = useTransform(scrollYProgress, [0, 1], [0, 180])
const orb4Y = useTransform(scrollYProgress, [0, 1], [0, -300])
const orb5Y = useTransform(scrollYProgress, [0, 1], [0, 260])
const orb6Y = useTransform(scrollYProgress, [0, 1], [0, -200])

const meshRotate = useTransform(scrollYProgress, [0, 1], [0, 30])
const veilX = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])
const veilY = useTransform(scrollYProgress, [0, 1], ['0%', '100%'])

// Deterministic star positions — keys ensure SSR/CSR match.
const STARS_SHALLOW = [
  { x: 8, y: 12, size: 3, delay: 0.0 }, { x: 18, y: 28, size: 2, delay: 1.4 },
  { x: 32, y: 8, size: 4, delay: 2.6 }, { x: 46, y: 22, size: 3, delay: 3.8 },
  { x: 58, y: 14, size: 2, delay: 5.1 }, { x: 72, y: 26, size: 3, delay: 0.9 },
  { x: 86, y: 10, size: 4, delay: 2.2 }, { x: 94, y: 32, size: 2, delay: 3.5 },
  { x: 12, y: 48, size: 3, delay: 4.7 }, { x: 28, y: 56, size: 2, delay: 1.2 },
  { x: 44, y: 44, size: 4, delay: 2.9 }, { x: 62, y: 52, size: 3, delay: 4.4 },
  { x: 78, y: 58, size: 2, delay: 0.6 }, { x: 90, y: 48, size: 3, delay: 1.8 },
  { x: 6, y: 72, size: 4, delay: 3.1 }, { x: 20, y: 78, size: 2, delay: 4.6 },
  { x: 38, y: 82, size: 3, delay: 0.3 }, { x: 54, y: 76, size: 4, delay: 2.4 },
  { x: 68, y: 84, size: 2, delay: 3.9 }, { x: 82, y: 72, size: 3, delay: 5.2 },
]
const STARS_DEEP = [
  { x: 14, y: 18, size: 5, delay: 1.1 }, { x: 36, y: 36, size: 6, delay: 3.2 },
  { x: 64, y: 16, size: 5, delay: 0.4 }, { x: 88, y: 40, size: 6, delay: 2.7 },
  { x: 22, y: 60, size: 5, delay: 4.5 }, { x: 48, y: 68, size: 6, delay: 1.6 },
  { x: 74, y: 64, size: 5, delay: 3.0 }, { x: 10, y: 88, size: 6, delay: 0.8 },
  { x: 32, y: 92, size: 5, delay: 2.1 }, { x: 56, y: 88, size: 6, delay: 4.0 },
  { x: 78, y: 90, size: 5, delay: 5.5 }, { x: 94, y: 76, size: 6, delay: 1.9 },
  { x: 4, y: 32, size: 5, delay: 3.6 }, { x: 42, y: 4, size: 6, delay: 4.8 },
  { x: 70, y: 38, size: 5, delay: 0.2 },
]

const PARTICLES = [
  { x: 5, size: 3, duration: 24, delay: 0 }, { x: 12, size: 2, duration: 32, delay: 4 },
  { x: 20, size: 4, duration: 28, delay: 9 }, { x: 28, size: 2, duration: 36, delay: 14 },
  { x: 35, size: 3, duration: 22, delay: 2 }, { x: 42, size: 5, duration: 30, delay: 11 },
  { x: 48, size: 2, duration: 26, delay: 18 }, { x: 54, size: 3, duration: 34, delay: 5 },
  { x: 61, size: 4, duration: 28, delay: 16 }, { x: 68, size: 2, duration: 22, delay: 8 },
  { x: 74, size: 3, duration: 32, delay: 3 }, { x: 80, size: 5, duration: 26, delay: 13 },
  { x: 86, size: 2, duration: 30, delay: 6 }, { x: 92, size: 3, duration: 24, delay: 19 },
  { x: 16, size: 2, duration: 38, delay: 21 }, { x: 38, size: 4, duration: 28, delay: 7 },
  { x: 58, size: 2, duration: 34, delay: 15 }, { x: 78, size: 4, duration: 26, delay: 1 },
  { x: 8, size: 3, duration: 36, delay: 17 }, { x: 32, size: 2, duration: 30, delay: 10 },
  { x: 50, size: 4, duration: 22, delay: 12 }, { x: 70, size: 3, duration: 32, delay: 20 },
  { x: 88, size: 4, duration: 28, delay: 6 }, { x: 24, size: 5, duration: 34, delay: 23 },
]

const LIGHT_RAYS = [
  { rot: 18, cls: 'animate-light-ray-a', top: '-20%' },
  { rot: -22, cls: 'animate-light-ray-b', top: '30%' },
  { rot: 12, cls: 'animate-light-ray-c', top: '55%' },
  { rot: -16, cls: 'animate-light-ray-d', top: '80%' },
]
</script>

<template>
  <div
    aria-hidden="true"
    class="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
  >
    <template v-if="mounted">
      <!-- Conic mesh -->
      <motion.div v-if="!reduce" class="absolute -inset-[10%] will-change-transform" :style="{ rotate: meshRotate }">
        <div
          class="animate-conic-spin h-full w-full opacity-80"
          :style="{
            background:
              'conic-gradient(from 0deg at 50% 50%, oklch(82% 0.18 30), oklch(90% 0.14 60), oklch(85% 0.16 90), oklch(78% 0.18 45), oklch(82% 0.18 20), oklch(82% 0.18 30))',
            filter: 'blur(70px)',
          }"
        />
      </motion.div>

      <!-- Aurora orbs (×6) -->
      <template v-if="!reduce">
        <motion.div :style="{ y: orb1Y }" class="absolute -left-40 top-[-10%] h-[640px] w-[640px] will-change-transform">
          <div class="animate-orb-drift-a h-full w-full rounded-full bg-(--color-rose)/60 blur-3xl" />
        </motion.div>
        <motion.div :style="{ y: orb2Y }" class="absolute -right-48 top-[20%] h-[760px] w-[760px] will-change-transform">
          <div class="animate-orb-drift-b h-full w-full rounded-full bg-(--color-champagne)/60 blur-3xl" />
        </motion.div>
        <motion.div :style="{ y: orb3Y }" class="absolute left-[20%] top-[55%] h-[560px] w-[560px] will-change-transform">
          <div class="animate-orb-drift-c h-full w-full rounded-full bg-(--color-accent)/55 blur-3xl" />
        </motion.div>
        <motion.div :style="{ y: orb4Y }" class="absolute -right-32 bottom-[-5%] h-[680px] w-[680px] will-change-transform">
          <div class="animate-orb-drift-d h-full w-full rounded-full bg-(--color-primary)/40 blur-3xl" />
        </motion.div>
        <motion.div :style="{ y: orb5Y }" class="absolute left-[40%] top-[10%] h-[500px] w-[500px] will-change-transform">
          <div class="animate-orb-drift-b h-full w-full rounded-full bg-(--color-rose)/45 blur-3xl" />
        </motion.div>
        <motion.div :style="{ y: orb6Y }" class="absolute left-[-20%] top-[40%] h-[600px] w-[600px] will-change-transform">
          <div class="animate-orb-drift-c h-full w-full rounded-full bg-(--color-champagne)/50 blur-3xl" />
        </motion.div>
      </template>

      <!-- Light rays -->
      <template v-if="!reduce">
        <div
          v-for="(r, i) in LIGHT_RAYS"
          :key="i"
          :class="['pointer-events-none absolute left-[-20%] h-[60px] w-[140%] will-change-transform', r.cls]"
          :style="{
            top: r.top,
            transform: `rotate(${r.rot}deg)`,
            background: 'linear-gradient(90deg, transparent 0%, oklch(95% 0.08 60 / 0.55) 50%, transparent 100%)',
            filter: 'blur(20px)',
          }"
        />
      </template>

      <!-- Drifting particles -->
      <template v-if="!reduce">
        <span
          v-for="(p, i) in PARTICLES"
          :key="i"
          class="animate-particle-rise pointer-events-none absolute rounded-full will-change-transform"
          :style="{
            left: `${p.x}%`,
            bottom: '-20px',
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: 'radial-gradient(circle, oklch(92% 0.06 60), oklch(78% 0.1 40) 70%, transparent 100%)',
            boxShadow: `0 0 ${p.size * 4}px oklch(82% 0.08 45 / 0.6)`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }"
        />
      </template>

      <!-- Scroll-driven hue veil -->
      <motion.div
        v-if="!reduce"
        class="absolute inset-0 will-change-transform"
        :style="{
          backgroundImage:
            'radial-gradient(circle 1100px at var(--vx) var(--vy), oklch(80% 0.15 35 / 0.45), transparent 60%)',
          '--vx': veilX,
          '--vy': veilY,
        }"
      />

      <!-- Stars (shallow + deep) -->
      <div class="absolute inset-0">
        <span
          v-for="(s, i) in STARS_SHALLOW"
          :key="`sh-${i}`"
          class="animate-star-twinkle absolute rounded-full"
          :style="{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            background: 'radial-gradient(circle, oklch(85% 0.08 30), oklch(72% 0.12 50) 70%, transparent 100%)',
            boxShadow: `0 0 ${s.size * 3}px oklch(80% 0.1 40 / 0.5)`,
            animationDelay: `${s.delay}s`,
          }"
        />
      </div>
      <div class="absolute inset-0">
        <span
          v-for="(s, i) in STARS_DEEP"
          :key="`dp-${i}`"
          class="animate-star-twinkle absolute rounded-full"
          :style="{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            background: 'radial-gradient(circle, oklch(85% 0.08 55), oklch(72% 0.12 75) 70%, transparent 100%)',
            boxShadow: `0 0 ${s.size * 3}px oklch(80% 0.1 65 / 0.5)`,
            animationDelay: `${s.delay}s`,
          }"
        />
      </div>

      <!-- Cursor halo + trail -->
      <template v-if="!reduce">
        <motion.div
          :style="{
            left: trail2X,
            top: trail2Y,
            translateX: '-50%',
            translateY: '-50%',
            background:
              'radial-gradient(circle, oklch(80% 0.1 30 / 0.88), transparent 70%)',
          }"
          class="absolute h-[340px] w-[340px] rounded-full blur-2xl will-change-transform"
        />
        <motion.div
          :style="{
            left: trail1X,
            top: trail1Y,
            translateX: '-50%',
            translateY: '-50%',
            background:
              'radial-gradient(circle, oklch(80% 0.1 40 / 1.12), transparent 70%)',
          }"
          class="absolute h-[480px] w-[480px] rounded-full blur-2xl will-change-transform"
        />
        <motion.div
          :style="{ left: haloX, top: haloY, translateX: '-50%', translateY: '-50%' }"
          class="absolute h-[780px] w-[780px] rounded-full bg-(--color-rose)/45 blur-3xl will-change-transform"
        />
      </template>

      <!-- Vignette -->
      <div
        class="absolute inset-0"
        :style="{
          background:
            'radial-gradient(ellipse at center, transparent 50%, oklch(60% 0.04 35 / 0.08) 100%)',
        }"
      />
    </template>
  </div>
</template>
