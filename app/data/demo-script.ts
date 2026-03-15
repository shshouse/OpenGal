import type { GalgameScript } from '~/types/galgame'
import type { CharacterProfile } from '~/data/characters'

export function buildDemoScript(char: CharacterProfile): GalgameScript {
  return {
    title: 'OpenGal',
    subtitle: 'AI Paper Reader',
    characters: [
      {
        id: char.id,
        name: char.name,
        nameColor: char.nameColor,
        sprites: char.sprites,
      },
    ],
    startSceneId: 'intro',
    scenes: [
      {
        id: 'intro',
        background: 'gradient:from-indigo-900/80 via-slate-900 to-pink-950/60',
        characters: [
          { characterId: char.id, expression: 'smile', position: 'center' },
        ],
        dialogues: [
          {
            characterId: null,
            text: '阳光透过窗帘洒落在书桌上，空气中弥漫着纸张的香味。',
          },
          {
            characterId: char.id,
            expression: 'smile',
            text: '啊，你来了！等你好久了呢~',
          },
          {
            characterId: char.id,
            expression: 'happy',
            text: `我是${char.name}，你的论文阅读搭档！今天我来帮你读懂那些复杂的学术论文~`,
          },
          {
            characterId: char.id,
            expression: 'normal',
            text: '那么，你今天想了解哪个方向的研究呢？',
            choices: [
              { text: '注意力机制 (Attention Mechanism)', nextSceneId: 'topic_attention' },
              { text: '扩散模型 (Diffusion Models)', nextSceneId: 'topic_diffusion' },
            ],
          },
        ],
      },
      {
        id: 'topic_attention',
        background: 'gradient:from-blue-950/80 via-slate-900 to-cyan-950/60',
        characters: [
          { characterId: char.id, expression: 'excited', position: 'center' },
        ],
        dialogues: [
          { characterId: char.id, expression: 'excited', text: '注意力机制！这可是现代 AI 的核心概念呢！' },
          { characterId: char.id, expression: 'normal', text: '简单来说，注意力机制就像你在考试的时候......' },
          { characterId: char.id, expression: 'thinking', text: '你不会把所有课本内容都记住，而是「关注」最重要的部分对吧？' },
          { characterId: char.id, expression: 'smile', text: 'AI 也是一样的！它会学习「该关注哪些信息」，忽略不重要的部分。' },
          {
            characterId: char.id,
            expression: 'serious',
            text: '好，来考考你~ 注意力机制中最关键的三个向量是什么？',
            choices: [
              { text: 'Query、Key、Value', nextSceneId: 'correct' },
              { text: 'Input、Output、Hidden', nextSceneId: 'wrong' },
            ],
          },
        ],
      },
      {
        id: 'topic_diffusion',
        background: 'gradient:from-purple-950/80 via-slate-900 to-violet-950/60',
        characters: [
          { characterId: char.id, expression: 'excited', position: 'center' },
        ],
        dialogues: [
          { characterId: char.id, expression: 'excited', text: '扩散模型！你选了个很前沿的课题呢~' },
          { characterId: char.id, expression: 'thinking', text: '想象一下，把墨水滴进清水里......墨水会慢慢扩散开。' },
          { characterId: char.id, expression: 'normal', text: '扩散模型就是把这个过程反过来——从噪声中一步步还原出清晰的图像。' },
          { characterId: char.id, expression: 'smile', text: 'Stable Diffusion、DALL-E 这些 AI 画图工具，用的就是这个原理~' },
          {
            characterId: char.id,
            expression: 'serious',
            text: '那么问题来了~ 扩散模型的核心思想是什么？',
            choices: [
              { text: '从噪声逐步去噪还原数据', nextSceneId: 'correct' },
              { text: '通过对抗训练生成数据', nextSceneId: 'wrong' },
            ],
          },
        ],
      },
      {
        id: 'correct',
        background: 'gradient:from-emerald-950/80 via-slate-900 to-teal-950/60',
        characters: [
          { characterId: char.id, expression: 'happy', position: 'center' },
        ],
        dialogues: [
          { characterId: char.id, expression: 'happy', text: '答对了！太厉害了！你果然很有天赋呢~' },
          { characterId: char.id, expression: 'shy', text: '嘿嘿，被你这样认真学习的样子感动到了......' },
        ],
        nextSceneId: 'ending',
      },
      {
        id: 'wrong',
        background: 'gradient:from-amber-950/80 via-slate-900 to-orange-950/60',
        characters: [
          { characterId: char.id, expression: 'thinking', position: 'center' },
        ],
        dialogues: [
          { characterId: char.id, expression: 'thinking', text: '嗯......不太对哦，不过没关系！' },
          { characterId: char.id, expression: 'smile', text: '学习本来就是不断试错的过程，重要的是你在思考~' },
        ],
        nextSceneId: 'ending',
      },
      {
        id: 'ending',
        background: 'gradient:from-rose-950/80 via-slate-900 to-pink-950/60',
        characters: [
          { characterId: char.id, expression: 'smile', position: 'center' },
        ],
        dialogues: [
          { characterId: char.id, expression: 'smile', text: '今天的学习就到这里啦！' },
          { characterId: char.id, expression: 'happy', text: '下次再带论文来找我吧~ 我会一直在这里等你的！' },
        ],
      },
    ],
  }
}
