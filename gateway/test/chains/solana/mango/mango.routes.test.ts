import request from 'supertest';
import { unpatch } from '../../../services/patch';
import { gatewayApp } from '../../../../src/app';
import Mango from '../../../../src/chains/solana/mango/mango';
import { SolanaConfig } from '../../../../src/chains/solana/solana.config';

let mango: Mango;
beforeAll(async () => {
  mango = Mango.getInstance();
  await mango.init();
});

afterEach(() => unpatch());

describe('GET /mango', () => {
  it('should return 200', async () => {
    request(gatewayApp)
      .get(`/mango`)
      .expect('Content-Type', /json/)
      .expect(200)
      .expect((res) =>
        expect(res.body.network).toBe(SolanaConfig.config.network.slug)
      )
      .expect((res) =>
        expect(res.body.rpcUrl).toBe(mango.mangoGroupConfig.name)
      )
      .expect((res) => expect(res.body.connection).toBe(true));
      // .expect((res) => expect(res.body.timestamp).toBeNumber());
  });
});

