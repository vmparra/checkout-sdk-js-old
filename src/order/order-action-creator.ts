import { createAction, createErrorAction, ThunkAction } from '@bigcommerce/data-store';
import { concat } from 'rxjs/observable/concat';
import { defer } from 'rxjs/observable/defer';
import { Observable } from 'rxjs/Observable';
import { Observer } from 'rxjs/Observer';

import { CheckoutClient, CheckoutValidator, InternalCheckoutSelectors } from '../checkout';
import { MissingDataError, MissingDataErrorType } from '../common/error/errors';
import { RequestOptions } from '../common/http-request';

import InternalOrderRequestBody from './internal-order-request-body';
import { FinalizeOrderAction, LoadOrderAction, LoadOrderPaymentsAction, OrderActionType, SubmitOrderAction } from './order-actions';
import OrderRequestBody from './order-request-body';

export default class OrderActionCreator {
    constructor(
        private _checkoutClient: CheckoutClient,
        private _checkoutValidator: CheckoutValidator
    ) {}

    loadOrder(orderId: number, options?: RequestOptions): Observable<LoadOrderAction> {
        return new Observable((observer: Observer<LoadOrderAction>) => {
            observer.next(createAction(OrderActionType.LoadOrderRequested));

            this._checkoutClient.loadOrder(orderId, options)
                .then(response => {
                    observer.next(createAction(OrderActionType.LoadOrderSucceeded, response.body));
                    observer.complete();
                })
                .catch(response => {
                    observer.error(createErrorAction(OrderActionType.LoadOrderFailed, response));
                });
        });
    }

    // TODO: Remove when checkout does not contain unrelated order data.
    loadCurrentOrderPayments(options?: RequestOptions): ThunkAction<LoadOrderPaymentsAction, InternalCheckoutSelectors> {
        return store => defer(() => {
            const orderId = this._getCurrentOrderId(store.getState());

            if (!orderId) {
                throw new MissingDataError(MissingDataErrorType.MissingOrderId);
            }

            return this._loadOrderPayments(orderId, options);
        });
    }

    loadCurrentOrder(options?: RequestOptions): ThunkAction<LoadOrderAction, InternalCheckoutSelectors> {
        return store => defer(() => {
            const orderId = this._getCurrentOrderId(store.getState());

            if (!orderId) {
                throw new MissingDataError(MissingDataErrorType.MissingOrderId);
            }

            return this.loadOrder(orderId, options);
        });
    }

    submitOrder(payload: OrderRequestBody, options?: RequestOptions): ThunkAction<SubmitOrderAction | LoadOrderAction, InternalCheckoutSelectors> {
        return store => concat(
            new Observable((observer: Observer<SubmitOrderAction>) => {
                observer.next(createAction(OrderActionType.SubmitOrderRequested));

                const state = store.getState();
                const checkout = state.checkout.getCheckout();

                if (!checkout) {
                    throw new MissingDataError(MissingDataErrorType.MissingCheckout);
                }

                this._checkoutValidator.validate(checkout, options)
                    .then(() => this._checkoutClient.submitOrder(this._mapToOrderRequestBody(payload, checkout.customerMessage), options))
                    .then(response => {
                        observer.next(createAction(OrderActionType.SubmitOrderSucceeded, response.body.data, { ...response.body.meta, token: response.headers.token }));
                        observer.complete();
                    })
                    .catch(response => {
                        observer.error(createErrorAction(OrderActionType.SubmitOrderFailed, response));
                    });
            }),
            // TODO: Remove once we can submit orders using storefront API
            this.loadCurrentOrder(options)(store)
        );
    }

    finalizeOrder(orderId: number, options?: RequestOptions): Observable<FinalizeOrderAction | LoadOrderAction> {
        return concat(
            new Observable((observer: Observer<FinalizeOrderAction>) => {
                observer.next(createAction(OrderActionType.FinalizeOrderRequested));

                this._checkoutClient.finalizeOrder(orderId, options)
                    .then(response => {
                        observer.next(createAction(OrderActionType.FinalizeOrderSucceeded, response.body.data));
                        observer.complete();
                    })
                    .catch(response => {
                        observer.error(createErrorAction(OrderActionType.FinalizeOrderFailed, response));
                    });
            }),
            // TODO: Remove once we can submit orders using storefront API
            this.loadOrder(orderId, options)
        );
    }

    // TODO: Remove when checkout does not contain unrelated order data.
    private _loadOrderPayments(orderId: number, options?: RequestOptions): Observable<LoadOrderPaymentsAction> {
        return new Observable((observer: Observer<LoadOrderPaymentsAction>) => {
            observer.next(createAction(OrderActionType.LoadOrderPaymentsRequested));

            this._checkoutClient.loadOrder(orderId, options)
                .then(response => {
                    observer.next(createAction(OrderActionType.LoadOrderPaymentsSucceeded, response.body));
                    observer.complete();
                })
                .catch(response => {
                    observer.error(createErrorAction(OrderActionType.LoadOrderPaymentsFailed, response));
                });
        });
    }

    private _getCurrentOrderId(state: InternalCheckoutSelectors): number | undefined {
        const order = state.order.getOrder();
        const checkout = state.checkout.getCheckout();
        return (order && order.orderId) || (checkout && checkout.orderId);
    }

    private _mapToOrderRequestBody(payload: OrderRequestBody, customerMessage: string): InternalOrderRequestBody {
        const { payment, ...order } = payload;

        if (!payment) {
            return order;
        }

        return {
            ...payload,
            customerMessage,
            payment: {
                paymentData: payment.paymentData,
                name: payment.methodId,
                gateway: payment.gatewayId,
            },
        };
    }
}
