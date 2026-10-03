import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { pickDealTemplate } from '@handshake/arena';
import { money } from '@handshake/core';
import type { Seller } from '@handshake/store';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { NoSeededSellersError, pickArenaDeal } from './arena-deal';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const attempt = { id: 'attempt-1', dailyChallengeDate: null };

const seller: Seller = {
  sellerId: 'seller-1',
  name: 'Ada',
  persona: 'Friendly.',
  floorPrice: money('20.00', 'USD'),
  listing: {
    productId: 'c3-1',
    title: 'Steel bottle',
    description: 'A steel bottle.',
    categoryPath: ['home'],
    listPrice: money('25.00', 'USD'),
  },
};

beforeEach(() => {
  dynamodb.reset();
});

describe('pickArenaDeal', () => {
  it('uses a fixed template without reading the table', async () => {
    const deal = await pickArenaDeal({ table, dealSource: 'templates' }, attempt);
    const template = pickDealTemplate(attempt);

    expect(deal).toEqual({
      sellerId: `arena-${template.id}`,
      seller: template.seller,
      listing: template.listing,
      buyer: template.buyer,
      acceptanceCriteria: template.acceptanceCriteria,
      deliveryDays: template.deliveryDays,
    });
    expect(dynamodb.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('turns a seeded seller into a deal whose criteria are drafted later', async () => {
    dynamodb.on(QueryCommand).resolves({ Items: [seller] });

    const deal = await pickArenaDeal({ table, dealSource: 'sellers' }, attempt);

    expect(deal).toMatchObject({
      sellerId: 'seller-1',
      buyer: { goal: 'Steel bottle', maxPrice: money('25.00', 'USD') },
      acceptanceCriteria: null,
    });
  });

  it('fails clearly when no sellers are seeded', async () => {
    dynamodb.on(QueryCommand).resolves({ Items: [] });

    await expect(pickArenaDeal({ table, dealSource: 'sellers' }, attempt)).rejects.toThrow(
      NoSeededSellersError,
    );
  });
});
