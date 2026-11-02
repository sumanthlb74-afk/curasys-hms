export function isWithinClinicHours(time, startHour, endHour) {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):00$/.test(time)) return false;
  const hour = Number(time.slice(0, 2));
  return hour >= startHour && hour < endHour;
}
