import { describe, expect, it } from 'vitest'
import {
  parseBingRss,
  parseDuckDuckGo,
  parseSo360,
} from '../../src/main/services/tools/builtin'

describe('本地搜索解析器', () => {
  it('Bing RSS 提取标题、链接和摘要', () => {
    const xml = `<rss><channel>
      <item><title>DeepSeek 开源 Super-agent</title><link>https://example.com/super</link><description>Router/Worker 双层架构</description></item>
      <item><title>第二条结果</title><link>https://example.com/other</link><description>摘要</description></item>
    </channel></rss>`
    const results = parseBingRss(xml)
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({
      title: 'DeepSeek 开源 Super-agent',
      url: 'https://example.com/super',
    })
    expect(results[0]?.snippet).toContain('双层架构')
  })

  it('DuckDuckGo 解开 uddg 跳转并保留正文摘要', () => {
    const html = `<div class="result">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fsuper-agent&rut=abc">Super-agent 架构</a></h2>
      <a class="result__snippet" href="x">双层架构说明</a>
    </div>`
    const results = parseDuckDuckGo(html)
    expect(results).toHaveLength(1)
    expect(results[0]?.url).toBe('https://example.com/super-agent')
    expect(results[0]?.title).toBe('Super-agent 架构')
    expect(results[0]?.snippet).toBe('双层架构说明')
  })

  it('360 优先使用 data-mdurl 真实地址', () => {
    const html = `<h3 class="res-title"><a href="/link?url=abc" data-mdurl="https://example.com/super">Super-agent 原型</a></h3>
      <p class="res-desc">原型说明</p>`
    const results = parseSo360(html)
    expect(results).toHaveLength(1)
    expect(results[0]?.url).toBe('https://example.com/super')
    expect(results[0]?.title).toBe('Super-agent 原型')
    expect(results[0]?.snippet).toBe('原型说明')
  })

  it('空页面返回空数组而不是异常', () => {
    expect(parseBingRss('<html></html>')).toEqual([])
    expect(parseDuckDuckGo('<html></html>')).toEqual([])
    expect(parseSo360('<html></html>')).toEqual([])
  })
})
