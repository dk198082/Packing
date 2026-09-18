import { differenceInCalendarDays, startOfToday, parseISO, isValid, format } from 'date-fns';
import type { Order, Readiness, DateBucket } from './types';

export function getReadiness(order: Order): Readiness {
  if (order.doNotProcess) return 'HOLD';
  if (!order.doNotProcessKnown) return 'ATTENTION';
  
  const logisticsText = [
    order.shippingInstructions,
    order.customerCarrierAccount,
    order.freightInformation,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const attentionPhrases = [
    'call customer',
    'see notes',
    'supplied label',
    'do not charge freight',
  ];
  const needsAttention =
    !order.customerPO ||
    !order.namedPlace ||
    !order.modeOfDelivery ||
    !order.incoterms ||
    !order.carrierForwarder ||
    attentionPhrases.some((phrase) => logisticsText.includes(phrase));
    
  if (needsAttention) return 'ATTENTION';
  return 'READY';
}

export function isMissingShipDate(dateString: string): boolean {
  return !dateString || /^1900-01-01(?:$|[T\s])/.test(dateString.trim());
}

export function getDateBucket(dateString: string, referenceDate: Date = startOfToday()): DateBucket {
  if (isMissingShipDate(dateString)) return 'OVERDUE';
  const date = parseISO(dateString);
  if (!isValid(date)) return 'LATER';
  
  const diff = differenceInCalendarDays(date, referenceDate);
  
  if (diff < 0) return 'OVERDUE';
  if (diff === 0) return 'DUE_TODAY';
  if (diff > 0 && diff <= 3) return 'NEXT_3_DAYS';
  return 'LATER';
}

export function formatDate(dateString: string): string {
  if (!dateString) return '';
  const date = parseISO(dateString);
  if (!isValid(date)) return dateString;
  return format(date, 'dd MMM yyyy').toUpperCase();
}

export function formatShortDate(dateString: string): string {
  if (!dateString) return '';
  const date = parseISO(dateString);
  if (!isValid(date)) return dateString;
  return format(date, 'dd MMM').toUpperCase();
}

export function formatCardDate(dateString: string): string {
  if (isMissingShipDate(dateString)) return 'No Ship Date';
  const date = parseISO(dateString);
  if (!isValid(date)) return dateString;
  return format(date, 'MMMM d, yyyy');
}

const WORKDAY_START_HOUR = 7;
const WORKDAY_END_HOUR = 15.5;
const WORKDAY_MINUTES = (WORKDAY_END_HOUR - WORKDAY_START_HOUR) * 60;

function getWorkElapsedMinutes(dateString: string, now: Date): number | null {
  if (!dateString) return null;
  const start = parseISO(dateString);
  if (!isValid(start)) return null;
  if (start >= now) return 0;

  const end = new Date(now);
  let cursor = new Date(start);
  let workMilliseconds = 0;

  while (cursor < end) {
    const nextMidnight = new Date(cursor);
    nextMidnight.setHours(24, 0, 0, 0);
    const isWeekday = cursor.getDay() !== 0 && cursor.getDay() !== 6;

    if (isWeekday) {
      const workdayStart = new Date(cursor);
      workdayStart.setHours(WORKDAY_START_HOUR, 0, 0, 0);
      const workdayEnd = new Date(cursor);
      workdayEnd.setHours(15, 30, 0, 0);
      const segmentStart = cursor > workdayStart ? cursor : workdayStart;
      const segmentEnd = end < workdayEnd ? end : workdayEnd;

      if (segmentStart < segmentEnd) {
        workMilliseconds += segmentEnd.getTime() - segmentStart.getTime();
      }
    }
    cursor = nextMidnight;
  }

  return Math.max(0, Math.floor(workMilliseconds / (60 * 1000)));
}

export function formatWorkDaysInPacking(dateString: string, now: Date = new Date()): string {
  const elapsedMinutes = getWorkElapsedMinutes(dateString, now);
  if (elapsedMinutes === null) return '—';
  if (elapsedMinutes < 60) return '<1hr';
  const days = Math.floor(elapsedMinutes / WORKDAY_MINUTES);
  const hours = Math.floor((elapsedMinutes % WORKDAY_MINUTES) / 60);
  return `${days} ${days === 1 ? 'work day' : 'work days'}, ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export function formatWorkDaysInPackingCompact(dateString: string, now: Date = new Date()): string {
  const elapsedMinutes = getWorkElapsedMinutes(dateString, now);
  if (elapsedMinutes === null) return '—';
  if (elapsedMinutes < 60) return '<1hr';
  return `${Math.floor(elapsedMinutes / WORKDAY_MINUTES)}D ${Math.floor((elapsedMinutes % WORKDAY_MINUTES) / 60)}H`;
}
