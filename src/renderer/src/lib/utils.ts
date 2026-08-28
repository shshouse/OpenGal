import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isMobile(): boolean {
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).get('mobile') === '1') return true
  if (window.matchMedia('(max-width: 767px)').matches) return true
  const ua = navigator.userAgent
  return /Capacitor|Android|iPhone|iPad|iPod/i.test(ua)
}
