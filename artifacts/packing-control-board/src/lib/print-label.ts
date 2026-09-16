import QRCode from 'qrcode';
import type { Order } from './types';
import { CUSTOM_BOX_NUMBER, getBoxDimensions, type OperatorBox } from './operator-fields';

const DYMO_30336_WIDTH_IN = 2.125;
const DYMO_30336_HEIGHT_IN = 1;
const DYMO_30336_CONTENT_WIDTH_IN = 2.08;
const DYMO_30336_CONTENT_HEIGHT_IN = 0.96;

export type PrintableBox = OperatorBox;

export type PrintLabelFailure =
  | 'NO_PICK_IDS'
  | 'NO_BOXES'
  | 'POPUP_BLOCKED'
  | 'QRCODE_ERROR';

export type PrintLabelResult =
  | { ok: true }
  | { ok: false; reason: PrintLabelFailure };

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function labelText(value: string): string {
  return escapeHtml(value.trim() || '—');
}

export function getPrintablePickIds(pickIds: string[]): string[] {
  return pickIds
    .map((pickId) => pickId.trim().toUpperCase())
    .filter((pickId) => /^IPR\d{6}$/.test(pickId));
}

export function hasIncompletePickIds(pickIds: string[]): boolean {
  return pickIds.some((pickId) => {
    const normalizedPickId = pickId.trim().toUpperCase();
    return normalizedPickId !== 'IPR' && !/^IPR\d{6}$/.test(normalizedPickId);
  });
}

export function getPrintableBoxes(boxes: PrintableBox[]): PrintableBox[] {
  return boxes.filter((box) => Boolean(box.boxNumber.trim() || box.weightLbs.trim()));
}

function formatBoxDimensions(box: PrintableBox): string {
  if (box.boxNumber !== CUSTOM_BOX_NUMBER) {
    return getBoxDimensions(box.boxNumber) || box.boxNumber;
  }

  return [box.dimensions.length, box.dimensions.width, box.dimensions.height]
    .map((dimension) => dimension.trim())
    .filter(Boolean)
    .join('X') || CUSTOM_BOX_NUMBER;
}

function formatBoxName(box: PrintableBox): string {
  if (!box.boxNumber || box.boxNumber === CUSTOM_BOX_NUMBER) return 'Custom';
  const boxNumber = box.boxNumber.match(/^BOX-(\d+)/i)?.[1];
  return boxNumber ? `Box-${boxNumber}` : box.boxNumber;
}

function formatBoxLine(box: PrintableBox): string {
  const weight = box.weightLbs.trim() ? `${box.weightLbs.trim()} lbs` : '';
  return [formatBoxName(box), formatBoxDimensions(box), weight]
    .filter(Boolean)
    .join(' ');
}

async function createQrCodeSvg(value: string): Promise<string> {
  const qrCodeSvg = await QRCode.toString(value, {
    type: 'svg',
    width: 128,
    margin: 0,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });

  return qrCodeSvg.replace(
    '<svg',
    `<svg aria-label="Pick IDs QR code: ${escapeHtml(value)}" role="img"`,
  );
}

function createLabelHtml(
  order: Order,
  pickIds: string[],
  boxes: Array<{ box: PrintableBox; qrCodeSvg: string }>,
): string {
  const pickIdValue = pickIds.join(',');
  const labels = boxes
    .map(
      ({ box, qrCodeSvg }, index) => `
    <main class="label${index === boxes.length - 1 ? ' last-label' : ''}">
       <div class="label-details${boxes.length > 1 ? ' multi-box-label' : ''}">
        <div class="line sales-order">${labelText(`${order.salesOrder}${order.isRetailOrder ? ' ECOMM' : ''}`)}</div>
        <div class="line customer">${labelText(order.customer)}</div>
        <div class="line pick-ids">${labelText(pickIdValue)}</div>
        <div class="line box-specs">${labelText(formatBoxLine(box))}</div>
        ${boxes.length > 1 ? `<div class="line label-count">${index + 1} of ${boxes.length}</div>` : ''}
      </div>
      <div class="qr-code">${qrCodeSvg}</div>
    </main>`,
    )
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>DYMO 30336 — Sales Order ${labelText(order.salesOrder)}</title>
    <style>
      @page {
        size: ${DYMO_30336_WIDTH_IN}in ${DYMO_30336_HEIGHT_IN}in;
        margin: 0;
      }

      * {
        box-sizing: border-box;
      }

      html {
        width: ${DYMO_30336_CONTENT_WIDTH_IN}in;
        margin: 0;
        padding: 0;
      }

      body {
        width: ${DYMO_30336_CONTENT_WIDTH_IN}in;
        margin: 0;
        padding: 0;
        background: #fff;
        color: #000;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 0;
        line-height: 0;
      }

      .label {
        width: ${DYMO_30336_CONTENT_WIDTH_IN}in;
        height: ${DYMO_30336_CONTENT_HEIGHT_IN}in;
        padding: 0.03in 0.045in;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 0.52in;
        column-gap: 0.045in;
        overflow: hidden;
      }

      .label:not(.last-label) {
        page-break-after: always;
        break-after: page;
      }

      .last-label {
        page-break-after: auto;
        break-after: auto;
      }

      .label-details {
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 0.016in;
        overflow: hidden;
        padding-left: 0.035in;
        transform: translateY(-0.07in);
      }

      .label-details.multi-box-label {
        transform: translateY(-0.02in);
      }

      .line {
        min-width: 0;
        font-size: 6.4pt;
        line-height: 1.05;
        overflow-wrap: anywhere;
      }

      .sales-order {
        font-size: 9pt;
        font-weight: 800;
      }

      .customer {
        font-size: 7pt;
        font-weight: 700;
      }

      .pick-ids {
        font-size: 6.4pt;
        font-weight: 700;
      }

      .box-specs {
        font-size: 6.4pt;
        font-weight: 700;
      }

      .label-count {
        font-size: 6.2pt;
        font-weight: 700;
      }

      .box-specs,
      .label-count {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .qr-code {
        align-self: center;
        justify-self: center;
        width: 0.52in;
        height: 0.52in;
        transform: translateX(-0.05in);
      }

      .qr-code svg {
        display: block;
        width: 100%;
        height: 100%;
      }

      @media screen {
        body {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .label {
          outline: 1px solid #bbb;
        }
      }
    </style>
  </head>
  <body>${labels}</body>
</html>`;
}

export async function printDymo30336Labels(
  order: Order,
  rawPickIds: string[],
  rawBoxes: PrintableBox[],
): Promise<PrintLabelResult> {
  const pickIds = getPrintablePickIds(rawPickIds);
  if (pickIds.length === 0 || hasIncompletePickIds(rawPickIds)) {
    return { ok: false, reason: 'NO_PICK_IDS' };
  }

  const boxes = getPrintableBoxes(rawBoxes);
  if (boxes.length === 0) {
    return { ok: false, reason: 'NO_BOXES' };
  }

  const printWindow = window.open('', '_blank', 'width=816,height=500');
  if (!printWindow) {
    return { ok: false, reason: 'POPUP_BLOCKED' };
  }

  try {
    const qrCodeValue = pickIds.join(',');
    const labels = await Promise.all(
      boxes.map(async (box) => ({
        box,
        qrCodeSvg: await createQrCodeSvg(qrCodeValue),
      })),
    );

    printWindow.document.open();
    printWindow.document.write(createLabelHtml(order, pickIds, labels));
    printWindow.document.close();

    const printWhenReady = async () => {
      await printWindow.document.fonts?.ready;
      printWindow.focus();
      printWindow.print();
    };

    printWindow.requestAnimationFrame(() => {
      printWindow.setTimeout(() => {
        void printWhenReady();
      }, 100);
    });

    return { ok: true };
  } catch {
    printWindow.close();
    return { ok: false, reason: 'QRCODE_ERROR' };
  }
}