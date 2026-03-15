import type { Character } from '~/types/galgame'

export interface CharacterProfile extends Character {
  description: string
  color: string
  previewSprite: string
}

export const characterProfiles: CharacterProfile[] = [
  {
    id: 'murasame',
    name: '丛雨',
    nameColor: '#ec4899',
    color: '#ec4899',
    description: '活泼开朗的少女，擅长用生动的比喻解释复杂概念',
    previewSprite: '/role/congyu-murasame/ムラサメa_1950_1316.png',
    sprites: {
      normal: '/role/congyu-murasame/ムラサメa_1950_1292.png',
      smile: '/role/congyu-murasame/ムラサメa_1950_1316.png',
      happy: '/role/congyu-murasame/ムラサメa_1950_1399.png',
      shy: '/role/congyu-murasame/ムラサメa_1950_1455.png',
      thinking: '/role/congyu-murasame/ムラサメa_1950_1548.png',
      surprised: '/role/congyu-murasame/ムラサメa_1950_1668.png',
      excited: '/role/congyu-murasame/ムラサメa_1950_1738.png',
      serious: '/role/congyu-murasame/ムラサメa_1950_1904.png',
    },
  },
  {
    id: 'lena',
    name: '蕾娜',
    nameColor: '#60a5fa',
    color: '#60a5fa',
    description: '温柔知性的大姐姐，说话条理清晰，逻辑严密',
    previewSprite: '/role/leina-lena/レナa_261_270.png',
    sprites: {
      normal: '/role/leina-lena/レナa_261_270.png',
      smile: '/role/leina-lena/レナa_261_271.png',
      happy: '/role/leina-lena/レナa_261_274.png',
      shy: '/role/leina-lena/レナa_261_277.png',
      thinking: '/role/leina-lena/レナa_261_280.png',
      surprised: '/role/leina-lena/レナa_261_284.png',
      excited: '/role/leina-lena/レナa_261_290.png',
      serious: '/role/leina-lena/レナa_261_286.png',
    },
  },
  {
    id: 'rouka',
    name: '芦花',
    nameColor: '#f59e0b',
    color: '#f59e0b',
    description: '沉稳冷静的学霸，擅长深入分析问题的本质',
    previewSprite: '/role/luhua-rouka/芦花a_685_275.png',
    sprites: {
      normal: '/role/luhua-rouka/芦花a_685_275.png',
      smile: '/role/luhua-rouka/芦花a_685_300.png',
      happy: '/role/luhua-rouka/芦花a_685_347.png',
      shy: '/role/luhua-rouka/芦花a_685_411.png',
      thinking: '/role/luhua-rouka/芦花a_685_463.png',
      surprised: '/role/luhua-rouka/芦花a_685_547.png',
      excited: '/role/luhua-rouka/芦花a_685_625.png',
      serious: '/role/luhua-rouka/芦花a_685_677.png',
    },
  },
  {
    id: 'koharu',
    name: '小春',
    nameColor: '#fb923c',
    color: '#fb923c',
    description: '元气满满的学妹，好奇心旺盛，喜欢追问到底',
    previewSprite: '/role/xiaochun-koharu/小春a_2020_2350.png',
    sprites: {
      normal: '/role/xiaochun-koharu/小春a_2020_2350.png',
      smile: '/role/xiaochun-koharu/小春a_2020_2367.png',
      happy: '/role/xiaochun-koharu/小春a_2020_2399.png',
      shy: '/role/xiaochun-koharu/小春a_2020_2436.png',
      thinking: '/role/xiaochun-koharu/小春a_2020_2476.png',
      surprised: '/role/xiaochun-koharu/小春a_2020_2532.png',
      excited: '/role/xiaochun-koharu/小春a_2020_2568.png',
      serious: '/role/xiaochun-koharu/小春a_2020_2603.png',
    },
  },
  {
    id: 'mako',
    name: '茉子',
    nameColor: '#c084fc',
    color: '#c084fc',
    description: '害羞内向的文学少女，总能给出独特的视角',
    previewSprite: '/role/mozi-mako/茉子a_0_1892_1947.png',
    sprites: {
      normal: '/role/mozi-mako/茉子a_0_1892_1947.png',
      smile: '/role/mozi-mako/茉子a_0_1892_1971.png',
      happy: '/role/mozi-mako/茉子a_0_1892_2018.png',
      shy: '/role/mozi-mako/茉子a_0_1892_2079.png',
      thinking: '/role/mozi-mako/茉子a_0_1892_2158.png',
      surprised: '/role/mozi-mako/茉子a_0_1892_2283.png',
      excited: '/role/mozi-mako/茉子a_0_1892_2395.png',
      serious: '/role/mozi-mako/茉子a_0_1892_2484.png',
    },
  },
  {
    id: 'yoshino',
    name: '芳乃',
    nameColor: '#34d399',
    color: '#34d399',
    description: '温柔的邻家少女，用最朴实的语言讲清道理',
    previewSprite: '/role/fangnai-yoshino/芳乃立绘a/芳乃a_1855_1939.png',
    sprites: {
      normal: '/role/fangnai-yoshino/芳乃立绘a/芳乃a_1855_1939.png',
      smile: '/role/fangnai-yoshino/芳乃立绘a/芳乃a_1855_1941.png',
      happy: '/role/fangnai-yoshino/芳乃立绘a/芳乃a_1855_1944.png',
      shy: '/role/fangnai-yoshino/芳乃立绘a/芳乃a_1855_1948.png',
      thinking: '/role/fangnai-yoshino/芳乃立绘a/芳乃a_1855_1950.png',
      surprised: '/role/fangnai-yoshino/芳乃立绘a/芳乃a_1855_1954.png',
      excited: '/role/fangnai-yoshino/芳乃立绘a/芳乃a_1855_1958.png',
      serious: '/role/fangnai-yoshino/芳乃立绘a/芳乃a_1855_1961.png',
    },
  },
]

export function getCharacterProfile(id: string): CharacterProfile | null {
  return characterProfiles.find((c) => c.id === id) ?? null
}
