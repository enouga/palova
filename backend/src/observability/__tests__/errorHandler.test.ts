jest.mock('../reportError');
import { reportError } from '../reportError';
import { errorHandler } from '../errorHandler';
import type { Request, Response, NextFunction } from 'express';

describe('errorHandler', () => {
  beforeEach(() => (reportError as jest.Mock).mockClear());

  it('capture avec le contexte requête puis répond 500', () => {
    const req = { originalUrl: '/api/x', method: 'POST', user: { id: 'u1' } } as unknown as Request;
    const json = jest.fn();
    const status = jest.fn(() => ({ json })) as unknown as Response['status'];
    const res = { status } as unknown as Response;
    const err = new Error('boom');

    errorHandler(err, req, res, (() => {}) as NextFunction);

    expect(reportError).toHaveBeenCalledWith(err, {
      source: 'express', route: '/api/x', method: 'POST', userId: 'u1',
    });
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Erreur interne du serveur' });
  });
});
