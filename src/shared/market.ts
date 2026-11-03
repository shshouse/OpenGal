export interface MarketMod {
  id: string
  mod_number: number
  title: string
  description: string | null
  media: { thumbnail_url?: string | null; image_urls?: string[] | null } | null
  tags: string[] | null
  view_count: number
  download_count: number
  like_count: number
  latest_version: string | null
  latest_version_id: string | null
  source_info: { source_type?: 'original' | 'repost' } | null
  game?: { id: string; name: string; icon_url: string | null } | null
  category?: { id: string; name: string; slug: string } | null
  author?: { id: string; username: string; avatar_url: string | null } | null
  versions?: Array<{
    id: string
    version: string
    file_size: number | null
    status: string
    created_at: string
  }> | null
}

export interface MarketListResult {
  game: {
    id: string
    name: string
    game_number: string
    icon_url: string | null
    images: string[] | null
    description: string | null
  }
  categories: Array<{ id: string; name: string; slug: string }>
  mods: MarketMod[]
  totalMods: number
  page: number
  pageSize: number
}
