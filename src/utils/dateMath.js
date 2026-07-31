const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

export function hoursBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / MS_PER_HOUR;
}

export function daysBetween(fromIso, toIso) {
  const hours = hoursBetween(fromIso, toIso);
  return hours === null ? null : hours / 24;
}

export function daysSince(iso, now = new Date()) {
  if (!iso) return null;
  return (now.getTime() - new Date(iso).getTime()) / MS_PER_DAY;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function mean(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

export function median(values) {
  const nums = values
    .filter((v) => typeof v === 'number' && !Number.isNaN(v))
    .slice()
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
}
