<template>
  <div class="relative flex h-screen w-screen overflow-hidden">

    <div class="absolute inset-0 bg-gradient-to-br from-rose-50 via-amber-50/80 to-sky-50" />
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-pink-100/60 via-transparent to-transparent" />
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-violet-100/40 via-transparent to-transparent" />


    <div
      class="absolute inset-0 opacity-[0.03]"
      :style="{
        backgroundImage: `radial-gradient(circle at 30% 50%, #ec4899 1px, transparent 1px),
                radial-gradient(circle at 70% 30%, #ec4899 1px, transparent 1px)`,
        backgroundSize: '80px 80px, 120px 120px',
      }"
    />


    <div
      v-for="(p, i) in petals"
      :key="i"
      class="petal absolute"
      :style="{
        width: '12px',
        height: '12px',
        left: p.left,
        top: '-20px',
        opacity: p.opacity,
        color: p.color,
        transform: `scale(${p.scale}) rotate(${p.rotate}deg)`,
        animationName: 'petalFall',
        animationDuration: p.dur,
        animationTimingFunction: 'linear',
        animationIterationCount: 'infinite',
        animationDelay: p.delay,
      }"
    >
      <Icon name="custom:petal" />
    </div>


    <div class="relative z-10 flex h-full w-full flex-col justify-between px-8 py-8 md:w-[50%] md:px-14 md:py-12">

      <div>
        <div class="flex items-end gap-3">
          <h1
            class="text-5xl font-black tracking-wider text-slate-800 md:text-6xl"
            style="font-family: 'Noto Serif SC', serif"
          >
            OpenGal
          </h1>
          <Icon name="mdi:creation" class="mb-2 h-5 w-5 text-pink-400/60" />
        </div>
        <p
          class="mt-2 text-sm tracking-[0.35em] text-slate-400"
          style="font-family: 'Noto Serif SC', serif"
        >
          AI Paper Reader
        </p>
        <div class="mt-4 h-px w-56 bg-gradient-to-r from-pink-300/50 via-violet-300/30 to-transparent" />
      </div>


      <nav class="flex flex-col gap-2.5">
        <button
          v-for="(item, i) in menuItems"
          :key="i"
          :class="[
            'group relative flex h-auto items-center gap-4 overflow-hidden rounded-xl border px-6 py-4 text-left transition-all duration-300 backdrop-blur-sm',
            hoveredItem === i
              ? 'border-pink-300/40 bg-white/70 shadow-lg shadow-pink-100/50'
              : 'border-white/60 bg-white/40 shadow-sm',
            'hover:border-pink-300/40 hover:bg-white/70 hover:shadow-lg hover:shadow-pink-100/50'
          ]"
          @mouseenter="hoveredItem = i"
          @mouseleave="hoveredItem = null"
          @click="item.onClick"
        >
          <div
            :class="[
              'absolute left-0 top-0 h-full w-1 rounded-l-xl bg-gradient-to-b transition-opacity duration-300 from-pink-400 via-violet-400 to-pink-300',
              hoveredItem === i ? 'opacity-100' : 'opacity-0'
            ]"
          />
          <div
            :class="[
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-300',
              hoveredItem === i
                ? 'bg-gradient-to-br from-pink-500 to-violet-500 text-white shadow-md shadow-pink-200/50'
                : 'bg-slate-100/80 text-slate-400'
            ]"
          >
            <Icon :name="item.icon" class="h-4 w-4" />
          </div>
          <div class="flex flex-col">
            <span
              :class="[
                'text-[15px] font-bold tracking-[0.15em] transition-colors duration-300',
                hoveredItem === i ? 'text-slate-800' : 'text-slate-600'
              ]"
              style="font-family: 'Noto Serif SC', serif"
            >
              {{ item.label }}
            </span>
            <span
              :class="[
                'text-[10px] tracking-[0.2em] transition-colors duration-300',
                hoveredItem === i ? 'text-pink-400' : 'text-slate-300'
              ]"
            >
              {{ item.sub }}
            </span>
          </div>
        </button>
      </nav>


      <p class="text-[10px] tracking-wider text-slate-300">OpenGal &copy; 2025</p>
    </div>


    <div class="absolute bottom-0 right-0 z-10 hidden h-full md:flex md:items-end">
      <img
        :src="encodeURI('/role/luhua-rouka/芦花a_685_275.png')"
        alt=""
        class="absolute bottom-0 right-[35%] h-[75vh] object-contain opacity-60"
        :style="{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 90%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 90%, transparent 100%)',
        }"
      />
      <img
        :src="encodeURI('/role/xiaochun-koharu/小春a_2020_2350.png')"
        alt=""
        class="absolute bottom-0 right-[5%] h-[70vh] object-contain opacity-50"
        :style="{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 90%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 8%, black 90%, transparent 100%)',
        }"
      />
      <img
        :src="encodeURI('/role/congyu-murasame/ムラサメa_1950_1316.png')"
        alt=""
        class="relative h-[88vh] object-contain drop-shadow-[0_0_40px_rgba(0,0,0,0.1)]"
        :style="{
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 5%, black 92%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 5%, black 92%, transparent 100%)',
        }"
      />
    </div>


    <div class="absolute inset-0 z-0 flex items-end justify-center md:hidden">
      <img
        :src="encodeURI('/role/congyu-murasame/ムラサメa_1950_1316.png')"
        alt=""
        class="h-[70vh] object-contain opacity-30"
      />
    </div>
  </div>
</template>

<script setup lang="ts">

const emit = defineEmits<{
  start: []
  openApiSettings: []
}>()

const hoveredItem = ref<number | null>(null)

const menuItems = [
  { icon: 'lucide:book-open', label: '开始阅读', sub: 'START READING', onClick: () => emit('start') },
  { icon: 'lucide:settings-2', label: 'API 设置', sub: 'CONFIG', onClick: () => emit('openApiSettings') },
  { icon: 'lucide:info', label: '关于', sub: 'ABOUT', onClick: () => {} },
]

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

const fix = (n: number, d = 4) => Number(n.toFixed(d))

const petals = Array.from({ length: 25 }, (_, i) => {
  const left = `${fix(seededRandom(i * 3 + 1) * 100)}%`
  const dur = `${fix(6 + seededRandom(i * 3 + 2) * 8)}s`
  const delay = `${fix(seededRandom(i * 3 + 3) * 10)}s`
  const opacity = fix(0.3 + seededRandom(i * 5 + 4) * 0.4)
  const scale = fix(0.5 + seededRandom(i * 5 + 5))
  const rotate = fix(seededRandom(i * 5 + 6) * 360)
  const colors = ['#fbb4c4', '#fcd5ce', '#f9d3e3'] as const
  return { left, dur, delay, opacity, scale, rotate, color: colors[i % 3] }
})
</script>
