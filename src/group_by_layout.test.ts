import {groupByLayout} from './group_by_layout';
import {describe, test, expect} from 'vitest';

describe('group by layout', () => {
    test('group layers whose ref properties are identical', () => {
        const a = {
            'id': 'parent',
            'type': 'line'
        };
        const b = {
            'id': 'child',
            'type': 'line'
        };
        expect(groupByLayout([a, b], {})).toEqual([[a, b]]);
        expect(groupByLayout([a, b], {})[0][0]).toBe(a);
        expect(groupByLayout([a, b], {})[0][1]).toBe(b);
    });

    test('group does not group unrelated layers', () => {
        expect(groupByLayout([
            {
                'id': 'parent',
                'type': 'line'
            },
            {
                'id': 'child',
                'type': 'fill'
            }
        ], {})).toEqual([
            [{
                'id': 'parent',
                'type': 'line'
            }], [{
                'id': 'child',
                'type': 'fill'
            }]
        ]);
    });

    test('group works even for differing layout key orders', () => {
        expect(groupByLayout([
            {
                'id': 'parent',
                'type': 'line',
                'layout': {'a': 1, 'b': 2}
            },
            {
                'id': 'child',
                'type': 'line',
                'layout': {'b': 2, 'a': 1}
            }
        ], {})).toEqual([[
            {
                'id': 'parent',
                'type': 'line',
                'layout': {'a': 1, 'b': 2}
            },
            {
                'id': 'child',
                'type': 'line',
                'layout': {'b': 2, 'a': 1}
            }
        ]]);
    });
});
