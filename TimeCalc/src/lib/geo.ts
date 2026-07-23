// GPS位置情報の距離計算（打刻機能の位置判定用）

const EARTH_RADIUS_METERS = 6371000;

/**
 * 2地点間の距離をHaversine公式で計算する（メートル）。
 */
export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 指定地点が中心地点から許容半径内にあるか判定する */
export function isWithinRadius(
  centerLat: number,
  centerLon: number,
  targetLat: number,
  targetLon: number,
  radiusMeters: number,
): boolean {
  return distanceMeters(centerLat, centerLon, targetLat, targetLon) <= radiusMeters;
}
