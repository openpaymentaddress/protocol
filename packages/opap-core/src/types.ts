export interface SepaPaymentHandler {
  readonly type: "sepa";
  readonly currency: "EUR";
  readonly name: string;
  readonly iban: string;
}

export interface Erc20PaymentHandler {
  readonly type: "erc20";
  readonly currency: string;
  readonly chain: string;
  readonly asset: string;
  readonly recipient: string;
  readonly symbol?: string;
}

export interface ExtensionPaymentHandler {
  readonly type: string;
  readonly currency: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export type PaymentHandler =
  SepaPaymentHandler | Erc20PaymentHandler | ExtensionPaymentHandler;

export interface DirectPayment {
  readonly type: "direct";
  readonly methods: readonly PaymentHandler[];
}

export interface DelegatePayment {
  readonly type: "delegate";
  readonly target: string;
}

export interface SplitRecipient {
  readonly recipient: string;
  readonly share_ppm: number;
  readonly target?: string;
}

export interface SplitExecution {
  readonly type: "erc20-contract";
  readonly currency: string;
  readonly adapter: string;
  readonly chain: string;
  readonly asset: string;
  readonly contract: string;
  readonly config_id: string;
}

export interface SplitPayment {
  readonly type: "split";
  readonly execution: SplitExecution;
  readonly recipients: readonly SplitRecipient[];
}

export interface OpapRecord {
  readonly version: 1;
  readonly id: string;
  readonly name?: string;
  readonly payment: DirectPayment | DelegatePayment | SplitPayment;
  readonly extensions?: Readonly<Record<string, unknown>>;
}
