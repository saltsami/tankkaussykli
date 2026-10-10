// Used only by legacy/local watches. Push watches are exclusively evaluated by the server.
export function shouldNotifyLocally(observedAt: string, price: number, threshold: number,
  previous: { observedAt?: string; notifiedAt?: number }, now: number, demo: boolean) {
  const observed = Date.parse(observedAt);
  return !demo && Number.isFinite(observed) && observed <= now && now - observed <= 24 * 60 * 60 * 1000 &&
    price <= threshold && previous.observedAt !== observedAt && now - (previous.notifiedAt ?? 0) >= 12 * 60 * 60 * 1000;
}
