import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
	it('appends PocketBase field errors to the generic message', () => {
		// The exact shape a ClientResponseError carries for a missing required relation.
		const err = {
			status: 400,
			response: {
				message: 'Failed to create record.',
				data: { persona: { code: 'validation_required', message: 'Cannot be blank.' } }
			}
		};
		expect(errorMessage(err)).toBe('Failed to create record. persona: Cannot be blank.');
	});

	it('joins multiple field errors and humanises field names', () => {
		const err = {
			response: {
				message: 'Failed to create record.',
				data: {
					profile_dir: { message: 'Value must be unique.' },
					platform: { message: 'Cannot be blank.' }
				}
			}
		};
		expect(errorMessage(err)).toBe(
			'Failed to create record. profile dir: Value must be unique.; platform: Cannot be blank.'
		);
	});

	it('accepts an already-unwrapped body', () => {
		const err = { message: 'Failed to create record.', data: { handle: { message: 'Invalid.' } } };
		expect(errorMessage(err)).toBe('Failed to create record. handle: Invalid.');
	});

	it('falls back to the plain message when there are no field errors', () => {
		expect(errorMessage(new Error('Network down'))).toBe('Network down');
		expect(errorMessage({ response: { message: 'Nope.', data: {} } })).toBe('Nope.');
	});

	it('handles junk without throwing', () => {
		expect(errorMessage(null)).toBe('Something went wrong.');
		expect(errorMessage(undefined, 'Custom.')).toBe('Custom.');
		expect(errorMessage('just a string')).toBe('just a string');
		expect(errorMessage({ response: { data: { x: 'not an object' } } })).toBe('Something went wrong.');
	});
});
