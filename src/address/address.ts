export default interface Address extends AddressRequestBody {
    country: string;
}

export interface AddressRequestBody {
    id?: string;
    email?: string;
    firstName: string;
    lastName: string;
    company: string;
    address1: string;
    address2: string;
    city: string;
    stateOrProvince: string;
    stateOrProvinceCode: string;
    countryCode: string;
    postalCode: string;
    phone: string;
    customFields: Array<{
        fieldId: string;
        fieldValue: string;
    }>;
}
