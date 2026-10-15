import { formatSportType, type CalendarSettings } from "./calendar-settings.types.ts";
import { ALL_SPORTS } from "./heart-rate.ts";
import { SPORT_GROUPS, sharesGroupData } from "./sport-groups.ts";

export { ALL_SPORTS };

export type ActivityMapTrack = {
  id: string;
  title: string;
  sportType: string;
  polyline: string;
};

export type ActivityMapData = {
  signedIn: boolean;
  tracks: ActivityMapTrack[];
  sportTypes: CalendarSettings["sportTypes"];
  sportGroupShares: CalendarSettings["sportGroupShares"];
};

export type MapSportOption = {
  sportType: string;
  members: string[];
};

export type LngLat = [number, number];

const LAT_M = 111_320;

export function decodePolyline(encoded: string): LngLat[] {
  const coords: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (index >= encoded.length) return coords;
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      if (index >= encoded.length) return coords;
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

export function mapSportOptions(
  sportTypes: string[],
  shares: CalendarSettings["sportGroupShares"],
  isVisible: (sportType: string) => boolean,
): MapSportOption[] {
  const remaining = new Set(sportTypes.filter(isVisible));
  const options: MapSportOption[] = [];
  for (const group of SPORT_GROUPS) {
    if (!sharesGroupData(shares, group.id)) continue;
    const members = group.members.filter((member) => remaining.has(member));
    if (members.length < 2) continue;
    options.push({ sportType: group.canonical, members: [...members] });
    for (const member of members) remaining.delete(member);
  }
  for (const sportType of remaining) {
    options.push({ sportType, members: [sportType] });
  }
  return options.sort((left, right) =>
    formatSportType(left.sportType).localeCompare(formatSportType(right.sportType)),
  );
}

function distanceM(from: LngLat, to: LngLat) {
  const midLat = ((from[1] + to[1]) / 2) * (Math.PI / 180);
  const dx = (to[0] - from[0]) * Math.cos(midLat) * LAT_M;
  const dy = (to[1] - from[1]) * LAT_M;
  return Math.hypot(dx, dy);
}

const HOME_FOCUS_M = 250_000;

function centroidOf(coordinates: LngLat[]): LngLat {
  return coordinates[Math.floor(coordinates.length / 2)]!;
}

export function focusBoundsOf(tracks: Array<{ coordinates: LngLat[] }>) {
  const withCoords = tracks.filter((track) => track.coordinates.length);
  if (!withCoords.length) return null;
  const centroids = withCoords.map((track) => centroidOf(track.coordinates));
  const lats = centroids.map((point) => point[1]).sort((left, right) => left - right);
  const lngs = centroids.map((point) => point[0]).sort((left, right) => left - right);
  const median: LngLat = [lngs[Math.floor(lngs.length / 2)]!, lats[Math.floor(lats.length / 2)]!];
  const nearby = withCoords.filter(
    (track) => distanceM(centroidOf(track.coordinates), median) <= HOME_FOCUS_M,
  );
  const focused =
    nearby.length >= Math.max(1, Math.ceil(withCoords.length * 0.5)) ? nearby : withCoords;
  return boundsOf(focused.flatMap((track) => track.coordinates));
}

export function boundsOf(coordinates: LngLat[]) {
  if (!coordinates.length) return null;
  let minLng = coordinates[0][0];
  let minLat = coordinates[0][1];
  let maxLng = minLng;
  let maxLat = minLat;
  for (const [lng, lat] of coordinates) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  if (minLng === maxLng && minLat === maxLat) {
    return {
      center: [minLng, minLat] as LngLat,
      zoom: 13,
      bounds: null,
    };
  }
  return {
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2] as LngLat,
    zoom: 11,
    bounds: [
      [minLng, minLat],
      [maxLng, maxLat],
    ] as [LngLat, LngLat],
  };
}
