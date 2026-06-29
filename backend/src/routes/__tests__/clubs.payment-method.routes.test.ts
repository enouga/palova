import '../../__mocks__/prisma';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const getMyPaymentMethod = jest.fn();
const removeMyPaymentMethod = jest.fn();
jest.mock('../../services/paymentMethod.service', () => ({
  PaymentMethodService: jest.fn().mockImplementation(() => ({ getMyPaymentMethod, removeMyPaymentMethod })),
}));

import app from '../../app';
const token = () => jwt.sign({ id: 'u1', email: 't@x.fr' }, process.env.JWT_SECRET!);

beforeEach(() => { getMyPaymentMethod.mockReset(); removeMyPaymentMethod.mockReset(); });

describe('GET /api/clubs/:slug/me/payment-method', () => {
  it('401 sans token', async () => {
    const res = await request(app).get('/api/clubs/demo/me/payment-method');
    expect(res.status).toBe(401);
  });
  it('200 + la carte', async () => {
    getMyPaymentMethod.mockResolvedValue({ brand: 'visa', last4: '4242', expMonth: 4, expYear: 2027 });
    const res = await request(app).get('/api/clubs/demo/me/payment-method').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.last4).toBe('4242');
    expect(getMyPaymentMethod).toHaveBeenCalledWith('demo', 'u1');
  });
});

describe('DELETE /api/clubs/:slug/me/payment-method', () => {
  it('200 ok:true', async () => {
    removeMyPaymentMethod.mockResolvedValue({ ok: true });
    const res = await request(app).delete('/api/clubs/demo/me/payment-method').set('Authorization', `Bearer ${token()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(removeMyPaymentMethod).toHaveBeenCalledWith('demo', 'u1');
  });
});
