// Weight, Box #, and Pick IDs are not part of the Azure ERP feed. They remain
// per-device browser data. Pack-start status is shared separately through the API.

export const CUSTOM_BOX_NUMBER = 'CUSTOM';
export const OPERATOR_FIELDS_UPDATED_EVENT = 'packing-board:operator-fields-updated';

export interface BoxDimensions {
  length: string;
  width: string;
  height: string;
}

export interface OperatorBox {
  boxNumber: string;
  weightLbs: string;
  dimensions: BoxDimensions;
}

export interface OperatorFields {
  boxes: OperatorBox[];
  pickIds: string[];
  packStartedAt: string | null;
}

const EMPTY_BOX_DIMENSIONS: BoxDimensions = {
  length: '',
  width: '',
  height: '',
};

const EMPTY_FIELDS: OperatorFields = {
  boxes: [{ boxNumber: '', weightLbs: '', dimensions: { ...EMPTY_BOX_DIMENSIONS } }],
  pickIds: ['IPR'],
  packStartedAt: null,
};

export const BOX_DIMENSIONS_BY_NUMBER: Record<string, string> = {
  'BOX-01-SHI-70101': '7X7X5',
  'BOX-02-SHI-70100': '10X7X6',
  'BOX-03-SHI-70300': '13X11X5',
  'BOX-04-SHI-70309': '13X11X9',
  'BOX-05-SHI-70400': '18X12X9',
  'BOX-06-SHI-80603': '16X13X13',
  'BOX-07-SHI-70800': '18X12X17',
  'BOX-08-SHI-70910': '21X16X29',
  'BOX-09-SHI-70912': '33X28X20',
  'BOX-10-SHI-70913': '19X11X13',
  'BOX-11-SHI-70301': '18X12X3',
  'BOX-12-SHI-70600': '21X7X7',
  'BOX-13-SHI80501': '9X9X9',
  'BOX-14-SHI-80601': '11X11X11',
  'BOX-19-SHI-04577': '4X4X28',
  'BOX-20-SHI-80504': '24X6X19',
  'BOX-21-SHI-80503': '40X10X10',
};

const STORAGE_KEY = 'packing-board:operator-fields:v1';

const RAW_BOX_NUMBERS = [
  'BOX-01-SHI-70101',
  'BOX-02-SHI-70100',
  'BOX-03-SHI-70300',
  'BOX-04-SHI-70309',
  'BOX-05-SHI-70400',
  'BOX-06-SHI-80603',
  'BOX-07-SHI-70800',
  'BOX-08-SHI-70910',
  'BOX-09-SHI-70912',
  'BOX-10-SHI-70913',
  'BOX-11-SHI-70301',
  'BOX-12-SHI-70600',
  'BOX-13-SHI80501',
  'BOX-14-SHI-80601',
  'BOX-19-SHI-04577',
  'BOX-20-SHI-80504',
  'BOX-21-SHI-80503',
];

function boxNumberSortKey(boxId: string): number {
  const match = boxId.match(/^BOX-(\d+)/);
  return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

export const BOX_NUMBER_OPTIONS: string[] = [...RAW_BOX_NUMBERS].sort(
  (a, b) => boxNumberSortKey(a) - boxNumberSortKey(b)
);

export function getBoxDimensions(boxNumber: string): string {
  return BOX_DIMENSIONS_BY_NUMBER[boxNumber] || '';
}

export function getBoxOptionLabel(boxNumber: string): string {
  const dimensions = getBoxDimensions(boxNumber);
  return dimensions ? `${boxNumber} — ${dimensions}` : boxNumber;
}

export function normalizePickId(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 6);
  return `IPR${digits}`;
}

export function formatPackStartDay(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function readStore(): Record<string, OperatorFields> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, OperatorFields>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore quota errors or unavailable storage (e.g. private browsing).
  }
}

export function getOperatorFields(orderId: string): OperatorFields {
  const store = readStore();
  const existing = store[orderId] as {
    boxes?: unknown;
    pickIds?: unknown;
    packStartedAt?: unknown;
    weightLbs?: string;
    boxNumber?: string;
    boxNumbers?: string[];
  } | undefined;
  if (!existing) {
    return {
      ...EMPTY_FIELDS,
      boxes: [{ boxNumber: '', weightLbs: '', dimensions: { ...EMPTY_BOX_DIMENSIONS } }],
      pickIds: ['IPR'],
    };
  }

  const savedBoxes = Array.isArray(existing.boxes)
    ? existing.boxes
        .filter((box): box is Record<string, unknown> => typeof box === 'object' && box !== null)
        .map((box) => ({
          boxNumber: typeof box.boxNumber === 'string' ? box.boxNumber : '',
          weightLbs: typeof box.weightLbs === 'string' ? box.weightLbs : '',
          dimensions: normalizeDimensions(box.dimensions),
        }))
    : (Array.isArray(existing.boxNumbers)
      ? existing.boxNumbers.filter((box): box is string => typeof box === 'string')
      : existing.boxNumber
        ? [existing.boxNumber]
        : ['']
    ).map((boxNumber) => ({
      boxNumber,
      weightLbs: typeof existing.weightLbs === 'string' ? existing.weightLbs : '',
      dimensions: { ...EMPTY_BOX_DIMENSIONS },
    }));
  const savedPickIds = Array.isArray(existing.pickIds) ? existing.pickIds : [];
  const pickIds = (savedPickIds.length > 0 ? savedPickIds : ['']).map(normalizePickId);
  return {
    ...EMPTY_FIELDS,
    ...existing,
    boxes: savedBoxes.length > 0
      ? savedBoxes
      : [{ boxNumber: '', weightLbs: '', dimensions: { ...EMPTY_BOX_DIMENSIONS } }],
    pickIds: pickIds.slice(0, 3),
    packStartedAt: typeof existing.packStartedAt === 'string' ? existing.packStartedAt : null,
  };
}

export function saveOperatorFields(orderId: string, fields: OperatorFields): void {
  const store = readStore();
  store[orderId] = {
    ...fields,
    packStartedAt: null,
    boxes: fields.boxes.filter((box) => Boolean(box.boxNumber || box.weightLbs)),
    pickIds: fields.pickIds.slice(0, 3).map(normalizePickId),
  };
  writeStore(store);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPERATOR_FIELDS_UPDATED_EVENT, { detail: { orderId } }));
  }
}

export function clearLegacyLocalPackStartedAt(orderId: string): void {
  const store = readStore();
  const existing = store[orderId];
  if (!existing || !existing.packStartedAt) return;
  store[orderId] = { ...existing, packStartedAt: null };
  writeStore(store);
}

function normalizeDimensions(value: unknown): BoxDimensions {
  if (typeof value !== 'object' || value === null) {
    return { ...EMPTY_BOX_DIMENSIONS };
  }

  const dimensions = value as Partial<BoxDimensions>;
  return {
    length: typeof dimensions.length === 'string' ? dimensions.length : '',
    width: typeof dimensions.width === 'string' ? dimensions.width : '',
    height: typeof dimensions.height === 'string' ? dimensions.height : '',
  };
}
