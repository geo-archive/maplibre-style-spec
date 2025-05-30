import {emptyStyle} from './empty';
import {validateStyleMin} from './validate_style.min';
import {describe, test, expect} from 'vitest';

describe('empty', () => {
    test('it generates something', () => {
        const style = emptyStyle();
        expect(style).toBeTruthy();
    });

    test('generated empty style is a valid style', () => {
        const errors = validateStyleMin(emptyStyle());
        expect(errors).toHaveLength(0);
    });
});
