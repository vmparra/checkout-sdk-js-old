import { combineReducers, Action } from '@bigcommerce/data-store';

import * as actionTypes from './instrument-action-types';

import Instrument from './instrument';
import InstrumentState, { InstrumentErrorState, InstrumentMeta, InstrumentStatusState } from './instrument-state';

const DEFAULT_STATE = {
    data: [],
    errors: {},
    statuses: {},
};

export default function instrumentReducer(state: InstrumentState = DEFAULT_STATE, action: Action): InstrumentState {
    const reducer = combineReducers<InstrumentState>({
        data: dataReducer,
        errors: errorsReducer,
        meta: metaReducer,
        statuses: statusesReducer,
    });

    return reducer(state, action);
}

function dataReducer(data: Instrument[] = DEFAULT_STATE.data, action: Action): Instrument[] {
    switch (action.type) {
    case actionTypes.LOAD_INSTRUMENTS_SUCCEEDED:
        return action.payload.vaultedInstruments || [];

    case actionTypes.DELETE_INSTRUMENT_SUCCEEDED:
        return data.filter(instrument =>
            instrument.bigpayToken !== action.meta.instrumentId
        );

    default:
        return data;
    }
}

function metaReducer(meta: InstrumentMeta | undefined, action: Action): InstrumentMeta | undefined {
    switch (action.type) {
    case actionTypes.LOAD_INSTRUMENTS_SUCCEEDED:
    case actionTypes.DELETE_INSTRUMENT_SUCCEEDED:
        return { ...meta, ...action.meta };

    default:
        return meta;
    }
}

function errorsReducer(errors: InstrumentErrorState = DEFAULT_STATE.errors, action: Action): InstrumentErrorState {
    switch (action.type) {
    case actionTypes.LOAD_INSTRUMENTS_REQUESTED:
    case actionTypes.LOAD_INSTRUMENTS_SUCCEEDED:
        return { ...errors, loadError: undefined };

    case actionTypes.DELETE_INSTRUMENT_REQUESTED:
    case actionTypes.DELETE_INSTRUMENT_SUCCEEDED:
        return {
            ...errors,
            deleteError: undefined,
            failedInstrument: undefined,
        };

    case actionTypes.LOAD_INSTRUMENTS_FAILED:
        return { ...errors, loadError: action.payload };

    case actionTypes.DELETE_INSTRUMENT_FAILED:
        return {
            ...errors,
            deleteError: action.payload,
            failedInstrument: action.meta.instrumentId,
        };

    default:
        return errors;
    }
}

function statusesReducer(statuses: InstrumentStatusState = DEFAULT_STATE.statuses, action: Action): InstrumentStatusState {
    switch (action.type) {
    case actionTypes.LOAD_INSTRUMENTS_REQUESTED:
        return { ...statuses, isLoading: true };

    case actionTypes.DELETE_INSTRUMENT_REQUESTED:
        return {
            ...statuses,
            isDeleting: true,
            deletingInstrument: action.meta.instrumentId,
        };

    case actionTypes.LOAD_INSTRUMENTS_SUCCEEDED:
    case actionTypes.LOAD_INSTRUMENTS_FAILED:
        return { ...statuses, isLoading: false };

    case actionTypes.DELETE_INSTRUMENT_SUCCEEDED:
    case actionTypes.DELETE_INSTRUMENT_FAILED:
        return {
            ...statuses,
            isDeleting: false,
            deletingInstrument: undefined,
        };

    default:
        return statuses;
    }
}
