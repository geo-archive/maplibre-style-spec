import {Color, isSupportedInterpolationColorSpace} from '../expression/types/color';
import {extendBy} from '../util/extend';
import {getType} from '../util/get_type';
import {Interpolate, interpolateFactory} from '../expression/definitions/interpolate';
import {Formatted} from '../expression/types/formatted';
import {ResolvedImage} from '../expression/types/resolved_image';
import {supportsInterpolation} from '../util/properties';
import {findStopLessThanOrEqualTo} from '../expression/stops';
import {Padding} from '../expression/types/padding';
import {ColorArray} from '../expression/types/color_array';
import {NumberArray} from '../expression/types/number_array';
import {typeOf} from '../expression/values';
import {ObjectType} from '../expression/types';
import {StylePropertySpecification} from '..';

export function isFunction(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && typeOf(value) === ObjectType;
}

function identityFunction(x) {
    return x;
}

function getParseFunction(propertySpec: StylePropertySpecification) {
    switch (propertySpec.type) {
        case 'color':
            return Color.parse;
        case 'padding':
            return Padding.parse;
        case 'numberArray':
            return NumberArray.parse;
        case 'colorArray':
            return ColorArray.parse;
        default:
            return null;
    }
}

function getInnerFunction(type: string) {
    switch (type) {
        case 'exponential':
            return evaluateExponentialFunction;
        case 'interval':
            return evaluateIntervalFunction;
        case 'categorical':
            return evaluateCategoricalFunction;
        case 'identity':
            return evaluateIdentityFunction;
        default:
            throw new Error(`Unknown function type "${type}"`);
    }
}

export function createFunction(parameters, propertySpec) {
    const zoomAndFeatureDependent = parameters.stops && typeof parameters.stops[0][0] === 'object';
    const featureDependent = zoomAndFeatureDependent || parameters.property !== undefined;
    const zoomDependent = zoomAndFeatureDependent || !featureDependent;
    const type = parameters.type || (supportsInterpolation(propertySpec) ? 'exponential' : 'interval');

    const parseFn = getParseFunction(propertySpec);
    if (parseFn) {
        parameters = extendBy({}, parameters);

        if (parameters.stops) {
            parameters.stops = parameters.stops.map((stop) => {
                return [stop[0], parseFn(stop[1])];
            });
        }

        if (parameters.default) {
            parameters.default = parseFn(parameters.default);
        } else {
            parameters.default = parseFn(propertySpec.default);
        }
    }

    if (parameters.colorSpace && !isSupportedInterpolationColorSpace(parameters.colorSpace)) {
        throw new Error(`Unknown color space: "${parameters.colorSpace}"`);
    }

    const innerFun = getInnerFunction(type);
    let hashedStops;
    let categoricalKeyType;
    if (type === 'categorical') {
        // For categorical functions, generate an Object as a hashmap of the stops for fast searching
        hashedStops = Object.create(null);
        for (const stop of parameters.stops) {
            hashedStops[stop[0]] = stop[1];
        }

        // Infer key type based on first stop key-- used to encforce strict type checking later
        categoricalKeyType = typeof parameters.stops[0][0];
    }

    if (zoomAndFeatureDependent) {
        const featureFunctions = {};
        const zoomStops = [];
        for (let s = 0; s < parameters.stops.length; s++) {
            const stop = parameters.stops[s];
            const zoom = stop[0].zoom;
            if (featureFunctions[zoom] === undefined) {
                featureFunctions[zoom] = {
                    zoom,
                    type: parameters.type,
                    property: parameters.property,
                    default: parameters.default,
                    stops: []
                };
                zoomStops.push(zoom);
            }
            featureFunctions[zoom].stops.push([stop[0].value, stop[1]]);
        }

        const featureFunctionStops = [];
        for (const z of zoomStops) {
            featureFunctionStops.push([featureFunctions[z].zoom, createFunction(featureFunctions[z], propertySpec)]);
        }

        const interpolationType = {name: 'linear'};
        return {
            kind: 'composite',
            interpolationType,
            interpolationFactor: Interpolate.interpolationFactor.bind(undefined, interpolationType),
            zoomStops: featureFunctionStops.map(s => s[0]),
            evaluate({zoom}, properties) {
                return evaluateExponentialFunction({
                    stops: featureFunctionStops,
                    base: parameters.base
                }, propertySpec, zoom).evaluate(zoom, properties);
            }
        };
    } else if (zoomDependent) {
        const interpolationType = type === 'exponential' ?
            {name: 'exponential', base: parameters.base !== undefined ? parameters.base : 1} : null;
        return {
            kind: 'camera',
            interpolationType,
            interpolationFactor: Interpolate.interpolationFactor.bind(undefined, interpolationType),
            zoomStops: parameters.stops.map(s => s[0]),
            evaluate: ({zoom}) => innerFun(parameters, propertySpec, zoom, hashedStops, categoricalKeyType)
        };
    } else {
        return {
            kind: 'source',
            evaluate(_, feature) {
                const value = feature && feature.properties ? feature.properties[parameters.property] : undefined;
                if (value === undefined) {
                    return coalesce(parameters.default, propertySpec.default);
                }
                return innerFun(parameters, propertySpec, value, hashedStops, categoricalKeyType);
            }
        };
    }
}

function coalesce(a, b, c?) {
    if (a !== undefined) return a;
    if (b !== undefined) return b;
    if (c !== undefined) return c;
}

function evaluateCategoricalFunction(parameters, propertySpec, input, hashedStops, keyType) {
    const evaluated = typeof input === keyType ? hashedStops[input] : undefined; // Enforce strict typing on input
    return coalesce(evaluated, parameters.default, propertySpec.default);
}

function evaluateIntervalFunction(parameters, propertySpec, input) {
    // Edge cases
    if (getType(input) !== 'number') return coalesce(parameters.default, propertySpec.default);
    const n = parameters.stops.length;
    if (n === 1) return parameters.stops[0][1];
    if (input <= parameters.stops[0][0]) return parameters.stops[0][1];
    if (input >= parameters.stops[n - 1][0]) return parameters.stops[n - 1][1];

    const index = findStopLessThanOrEqualTo(parameters.stops.map((stop) => stop[0]), input);

    return parameters.stops[index][1];
}

function evaluateExponentialFunction(parameters, propertySpec, input) {
    const base = parameters.base !== undefined ? parameters.base : 1;

    // Edge cases
    if (getType(input) !== 'number') return coalesce(parameters.default, propertySpec.default);
    const n = parameters.stops.length;
    if (n === 1) return parameters.stops[0][1];
    if (input <= parameters.stops[0][0]) return parameters.stops[0][1];
    if (input >= parameters.stops[n - 1][0]) return parameters.stops[n - 1][1];

    const index = findStopLessThanOrEqualTo(parameters.stops.map((stop) => stop[0]), input);
    const t = interpolationFactor(
        input, base,
        parameters.stops[index][0],
        parameters.stops[index + 1][0]);

    const outputLower = parameters.stops[index][1];
    const outputUpper = parameters.stops[index + 1][1];
    const interp = interpolateFactory[propertySpec.type] || identityFunction;

    if (typeof outputLower.evaluate === 'function') {
        return {
            evaluate(...args) {
                const evaluatedLower = outputLower.evaluate.apply(undefined, args);
                const evaluatedUpper = outputUpper.evaluate.apply(undefined, args);
                // Special case for fill-outline-color, which has no spec default.
                if (evaluatedLower === undefined || evaluatedUpper === undefined) {
                    return undefined;
                }
                return interp(evaluatedLower, evaluatedUpper, t, parameters.colorSpace);
            }
        };
    }

    return interp(outputLower, outputUpper, t, parameters.colorSpace);
}

function evaluateIdentityFunction(parameters, propertySpec, input) {
    switch (propertySpec.type) {
        case 'color':
            input = Color.parse(input);
            break;
        case 'formatted':
            input = Formatted.fromString(input.toString());
            break;
        case 'resolvedImage':
            input = ResolvedImage.fromString(input.toString());
            break;
        case 'padding':
            input = Padding.parse(input);
            break;
        case 'colorArray':
            input = ColorArray.parse(input);
            break;
        case 'numberArray':
            input = NumberArray.parse(input);
            break;
        default:
            if (getType(input) !== propertySpec.type && (propertySpec.type !== 'enum' || !propertySpec.values[input])) {
                input = undefined;
            }
    }
    return coalesce(input, parameters.default, propertySpec.default);
}

/**
 * Returns a ratio that can be used to interpolate between exponential function
 * stops.
 *
 * How it works:
 * Two consecutive stop values define a (scaled and shifted) exponential
 * function `f(x) = a * base^x + b`, where `base` is the user-specified base,
 * and `a` and `b` are constants affording sufficient degrees of freedom to fit
 * the function to the given stops.
 *
 * Here's a bit of algebra that lets us compute `f(x)` directly from the stop
 * values without explicitly solving for `a` and `b`:
 *
 * First stop value: `f(x0) = y0 = a * base^x0 + b`
 * Second stop value: `f(x1) = y1 = a * base^x1 + b`
 * => `y1 - y0 = a(base^x1 - base^x0)`
 * => `a = (y1 - y0)/(base^x1 - base^x0)`
 *
 * Desired value: `f(x) = y = a * base^x + b`
 * => `f(x) = y0 + a * (base^x - base^x0)`
 *
 * From the above, we can replace the `a` in `a * (base^x - base^x0)` and do a
 * little algebra:
 * ```
 * a * (base^x - base^x0) = (y1 - y0)/(base^x1 - base^x0) * (base^x - base^x0)
 *                     = (y1 - y0) * (base^x - base^x0) / (base^x1 - base^x0)
 * ```
 *
 * If we let `(base^x - base^x0) / (base^x1 base^x0)`, then we have
 * `f(x) = y0 + (y1 - y0) * ratio`.  In other words, `ratio` may be treated as
 * an interpolation factor between the two stops' output values.
 *
 * (Note: a slightly different form for `ratio`,
 * `(base^(x-x0) - 1) / (base^(x1-x0) - 1) `, is equivalent, but requires fewer
 * expensive `Math.pow()` operations.)
 *
 * @private
 */
function interpolationFactor(input, base, lowerValue, upperValue) {
    const difference = upperValue - lowerValue;
    const progress = input - lowerValue;

    if (difference === 0) {
        return 0;
    } else if (base === 1) {
        return progress / difference;
    } else {
        return (Math.pow(base, progress) - 1) / (Math.pow(base, difference) - 1);
    }
}
