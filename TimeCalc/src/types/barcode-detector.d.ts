// BarcodeDetector Web API の最小限の型宣言
// 標準libに未収録（Android Chrome等の一部ブラウザのみ実装、iOS Safariは非対応）。
// 実装のない環境向けフォールバックは src/components/qr/use-qr-scanner.ts の jsQR 経路が担う。

interface BarcodeDetectorOptions {
  formats?: string[];
}

interface DetectedBarcode {
  rawValue: string;
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  static getSupportedFormats(): Promise<string[]>;
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
