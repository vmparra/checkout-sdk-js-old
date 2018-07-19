import { CheckoutStore, InternalCheckoutSelectors } from '../../../checkout';
import {
    InvalidArgumentError,
    NotInitializedError,
    NotInitializedErrorType,
    StandardError,
    TimeoutError,
    UnsupportedBrowserError,
} from '../../../common/error/errors';
import { OrderActionCreator, OrderRequestBody } from '../../../order';
import { RequestSender, Response } from '@bigcommerce/request-sender';
import { toFormUrlEncoded } from '../../../common/http-request';
import { NonceInstrument } from '../../payment';
import PaymentActionCreator from '../../payment-action-creator';
import { PaymentInitializeOptions, PaymentRequestOptions } from '../../payment-request-options';
import PaymentStrategy from '../payment-strategy';

import SquarePaymentForm, { SquareFormElement, SquareFormOptions, SquareSuccessPayload } from './square-form';
import SquareScriptLoader from './square-script-loader';
import { resolve } from 'url';
import { FormPoster } from '@bigcommerce/form-poster';
import Cart from '../../../cart/cart';
import { getCurrency } from '../../../currency/currencies.mock';

export default class SquarePaymentStrategy extends PaymentStrategy {
    private _paymentForm?: SquarePaymentForm;
    private _deferredRequestNonce?: DeferredPromise;

    constructor(
        store: CheckoutStore,
        private _orderActionCreator: OrderActionCreator,
        private _paymentActionCreator: PaymentActionCreator,
        private _scriptLoader: SquareScriptLoader,
        private _requestSender: RequestSender,
        private _formPoster: FormPoster
    ) {
        super(store);
    }

    initialize(options: PaymentInitializeOptions): Promise<InternalCheckoutSelectors> {
        return this._scriptLoader.load()
            .then(createSquareForm =>
                new Promise((resolve, reject) => {
                    this._paymentForm = createSquareForm(
                        this._getFormOptions(options, { resolve, reject })
                    );

                    this._paymentForm.build();
                }))
            .then(() => super.initialize(options));
    }

    execute(payload: OrderRequestBody, options?: PaymentRequestOptions): Promise<InternalCheckoutSelectors> {
        const { payment, ...order } = payload;

        if (!payment || !payment.methodId) {
            throw new InvalidArgumentError('Unable to submit payment because "payload.payment.methodId" argument is not provided.');
        }

        const paymentName = payment.methodId;

        return new Promise<NonceInstrument>((resolve, reject) => {
            if (!this._paymentForm) {
                throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
            }

            if (this._deferredRequestNonce) {
                this._deferredRequestNonce.reject(new TimeoutError());
            }

            this._deferredRequestNonce = { resolve, reject };
            this._paymentForm.requestCardNonce();
        })
        .then(paymentData => {
            const paymentPayload = {
                methodId: paymentName,
                paymentData,
            };

            return this._store.dispatch(this._orderActionCreator.submitOrder(order, options))
                .then(() =>
                    this._store.dispatch(this._paymentActionCreator.submitPayment(paymentPayload))
                );
        });
    }

    private _getFormOptions(options: PaymentInitializeOptions, deferred: DeferredPromise): SquareFormOptions {
        const { square: squareOptions, methodId } = options;
        const state = this._store.getState();
        const paymentMethod = state.paymentMethods.getPaymentMethod(methodId);

        if (!squareOptions || !paymentMethod) {
            throw new InvalidArgumentError('Unable to proceed because "options.square" argument is not provided.');
        }

        return {
            ...squareOptions,
            ...paymentMethod.initializationData,
            callbacks: {
                paymentFormLoaded: () => {
                    deferred.resolve();
                    const state = this._store.getState();
                    const billingAddress = state.billingAddress.getBillingAddress();

                    if (!this._paymentForm) {
                        throw new NotInitializedError(NotInitializedErrorType.PaymentNotInitialized);
                    }

                    if (billingAddress && billingAddress.postalCode) {
                        this._paymentForm.setPostalCode(billingAddress.postalCode);
                    }
                },
                unsupportedBrowserDetected: () => {
                    deferred.reject(new UnsupportedBrowserError());
                },
                cardNonceResponseReceived: (errors: any, nonce: any, cardData: any) => {
                    if (cardData.digital_wallet_type.toUpperCase() != 'NONE') {
                        this._setExternalCheckoutData(cardData, nonce)
                        .then(() => {
                            this._reloadPage();
                        })
                    }
                    else {
                        this._cardNonceResponseReceived(errors, nonce);
                    }
                },
                methodsSupported: (methods: any) => {

                },

                /*
                 * callback function: createPaymentRequest
                 * Triggered when: a digital wallet payment button is clicked.
                */
                createPaymentRequest: () => {
                    let cart =  this._store.getState().cart.getCart();
                    var paymentRequestJson = {
                        currencyCode: cart!.currency.code,
                        countryCode: "US",
                        total: {
                            label: "BigCommerce",
                            amount: cart!.baseAmount.toLocaleString(),
                        }
                    };

                    return paymentRequestJson;
                },
            },
        };
    }

    private _reloadPage(): void {
        this._formPoster.postForm('/checkout.php', {
            headers: {
                Accept: 'text/html',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            params: {
                
            },
        });
    }

    private _cardNonceResponseReceived(errors: any, nonce: string): void {
        if (!this._deferredRequestNonce) {
            throw new StandardError();
        }

        if (errors) {
            this._deferredRequestNonce.reject(errors);
        } else {
            this._deferredRequestNonce.resolve({ nonce });
        }
    }

    private _setExternalCheckoutData(payload: SquareSuccessPayload, nonce: string): Promise<Response> {
        const url = `checkout.php?provider=squarev2&action=set_external_checkout`;
        const options = {
          headers: {
            Accept: 'text/html',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
          body: toFormUrlEncoded({
              nonce: nonce,
              card_data: JSON.stringify(payload),
          }),
        };
    
        return this._requestSender.post(url, options);
      }
}

export interface DeferredPromise {
    resolve(resolution?: NonceInstrument): void;
    reject(reason?: any): void;
}

/**
 * A set of options that are required to initialize the Square payment method.
 *
 * Once Square payment is initialized, credit card form fields, provided by the
 * payment provider as iframes, will be inserted into the current page. These
 * options provide a location and styling for each of the form fields.
 */
export interface SquarePaymentInitializeOptions {
    /**
     * The location to insert the credit card number form field.
     */
    cardNumber: SquareFormElement;

    /**
     * The location to insert the CVV form field.
     */
    cvv: SquareFormElement;

    /**
     * The location to insert the expiration date form field.
     */
    expirationDate: SquareFormElement;

    /**
     * The location to insert the postal code form field.
     */
    postalCode: SquareFormElement;

    /**
     * The CSS class to apply to all form fields.
     */
    inputClass?: string;

    /**
     * The set of CSS styles to apply to all form fields.
     */
    inputStyles?: Array<{ [key: string]: string }>;

    // Initialize Masterpass placeholder ID
    masterpass?: SquareFormElement; 
}
