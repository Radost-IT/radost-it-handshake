export const channel3Bottle = {
  id: 'c3-bottle',
  title: 'Steel water bottle',
  description: 'Keeps drinks cold.',
  brands: [{ id: 'b1', name: 'Hydra' }],
  category: {
    slug: 'water-bottles',
    title: 'Water bottles',
    has_children: false,
    path: [
      { slug: 'home', title: 'Home' },
      { slug: 'water-bottles', title: 'Water bottles' },
    ],
  },
  key_features: ['750 ml', 'Lid included'],
  offers: [
    {
      url: 'https://shop.example/out',
      domain: 'shop.example',
      price: { price: 30, currency: 'EUR' },
      availability: 'OutOfStock',
    },
    {
      url: 'https://store.example/bottle',
      domain: 'store.example',
      price: { price: 24.99, currency: 'USD' },
      availability: 'InStock',
    },
  ],
};
