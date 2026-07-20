/**
 * Sample content for the local demo. Written to exercise the features rather
 * than to look plausible in a screenshot: varied cuisines and difficulties, a
 * recipe with no stated time (so the "not stated" path is visible), amounts the
 * scaler can read and amounts it deliberately cannot, and multi-step
 * instructions so cook mode has something to walk through.
 */

export const DEMO_USERS = [
  { uid: 'demo-user', email: 'you@example.com', displayName: 'You' },
  { uid: 'amina-uid', email: 'amina@example.com', displayName: 'Amina Raza' },
  { uid: 'bilal-uid', email: 'bilal@example.com', displayName: 'Bilal Khan' },
  { uid: 'sara-uid', email: 'sara@example.com', displayName: 'Sara Ahmed' },
];

interface SeedRecipe {
  title: string;
  image: string;
  overview: string;
  ingredients: { amount: string; name: string }[];
  instructions: string;
  author: string;
  authorName: string;
  authorEmail: string;
  tags: string[];
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
  cuisine: string;
  ratings: { userId: string; score: number }[];
  comments: { text: string; authorId: string; authorName: string }[];
}

const IMG = (id: string) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200`;

export const DEMO_RECIPES: SeedRecipe[] = [
  {
    title: 'Chicken Karahi',
    image: IMG('2474661'),
    overview:
      'A fast, fiery karahi built on tomatoes and ginger, finished with green chilli and coriander. The kind of thing you make on a Tuesday and think about on a Wednesday.',
    ingredients: [
      { amount: '1 kg', name: 'chicken, bone-in, cut small' },
      { amount: '4 tbsp', name: 'ghee' },
      { amount: '500 g', name: 'tomatoes, roughly chopped' },
      { amount: '2 tbsp', name: 'ginger, julienned' },
      { amount: '1 tbsp', name: 'garlic paste' },
      { amount: '2 tsp', name: 'coriander seeds, crushed' },
      { amount: '1 tsp', name: 'red chilli flakes' },
      { amount: '4', name: 'green chillies, slit' },
      { amount: 'to taste', name: 'salt' },
      { amount: 'a handful', name: 'fresh coriander' },
    ],
    instructions:
      '<p>Heat the ghee in a wide, heavy pan over a high flame until it shimmers.</p>' +
      '<p>Add the chicken and the garlic paste. Fry hard for eight to ten minutes, without stirring too often, until the pieces have caught colour on every side.</p>' +
      '<p>Tip in the tomatoes and half the ginger. Cover and cook for fifteen minutes, until the tomatoes have collapsed entirely and the oil has begun to separate at the edges.</p>' +
      '<p>Uncover. Add the crushed coriander seeds, the chilli flakes and salt, and cook on high for five minutes more, pressing the tomatoes against the side of the pan.</p>' +
      '<p>Fold through the green chillies and the remaining ginger. Rest for two minutes off the heat, scatter with coriander, and take it to the table in the pan.</p>',
    author: 'amina-uid',
    authorName: 'Amina Raza',
    authorEmail: 'amina@example.com',
    tags: ['dinner', 'spicy', 'chicken'],
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 35,
    difficulty: 'medium',
    cuisine: 'Pakistani',
    ratings: [
      { userId: 'bilal-uid', score: 5 },
      { userId: 'sara-uid', score: 5 },
      { userId: 'demo-user', score: 4 },
    ],
    comments: [
      {
        text: 'Made this with lamb instead and it worked beautifully. Needed another twenty minutes covered.',
        authorId: 'bilal-uid',
        authorName: 'Bilal Khan',
      },
      {
        text: 'The trick really is not stirring the chicken early on. Let it catch.',
        authorId: 'sara-uid',
        authorName: 'Sara Ahmed',
      },
    ],
  },
  {
    title: 'Lemon Drizzle Cake',
    image: IMG('45202'),
    overview:
      'A sharp, wet-topped loaf that keeps for the better part of a week and improves on day two. Halve it or double it — the amounts scale cleanly.',
    ingredients: [
      { amount: '225 g', name: 'unsalted butter, softened' },
      { amount: '225 g', name: 'caster sugar' },
      { amount: '4', name: 'eggs' },
      { amount: '225 g', name: 'self-raising flour' },
      { amount: '1 tsp', name: 'baking powder' },
      { amount: '2', name: 'lemons, zested' },
      { amount: '85 g', name: 'granulated sugar' },
      { amount: '1/2', name: 'lemon, juiced' },
    ],
    instructions:
      '<p>Heat the oven to 180°C and line a two-pound loaf tin.</p>' +
      '<p>Beat the butter and caster sugar until pale and noticeably lighter — three or four minutes in a mixer, longer by hand.</p>' +
      '<p>Add the eggs one at a time, then fold in the flour, baking powder and lemon zest.</p>' +
      '<p>Scrape into the tin and bake for forty-five to fifty minutes, until a skewer comes out clean.</p>' +
      '<p>Mix the granulated sugar with the lemon juice and spoon it over the cake while it is still hot in the tin. It will crackle as it sets.</p>' +
      '<p>Leave to cool completely before turning out.</p>',
    author: 'demo-user',
    authorName: 'You',
    authorEmail: 'you@example.com',
    tags: ['dessert', 'baking', 'quick'],
    servings: 8,
    prepMinutes: 20,
    cookMinutes: 50,
    difficulty: 'easy',
    cuisine: 'British',
    ratings: [
      { userId: 'amina-uid', score: 5 },
      { userId: 'bilal-uid', score: 4 },
    ],
    comments: [
      {
        text: 'Doubled it for a birthday and the scaling was spot on. Baked for an extra ten minutes.',
        authorId: 'amina-uid',
        authorName: 'Amina Raza',
      },
    ],
  },
  {
    title: 'Fifteen-Minute Garlic Noodles',
    image: IMG('884600'),
    overview: 'Storecupboard noodles for a night when cooking is not the plan. Ready before the kettle cools.',
    ingredients: [
      { amount: '200 g', name: 'egg noodles' },
      { amount: '6', name: 'garlic cloves, finely sliced' },
      { amount: '3 tbsp', name: 'soy sauce' },
      { amount: '1 tbsp', name: 'sesame oil' },
      { amount: '2 tsp', name: 'brown sugar' },
      { amount: '2', name: 'spring onions, sliced' },
      { amount: 'a pinch', name: 'chilli flakes' },
    ],
    instructions:
      '<p>Boil the noodles for the time on the packet, then drain, keeping a mugful of the water.</p>' +
      '<p>Meanwhile, warm the sesame oil in a pan and cook the garlic gently until it is pale gold. Do not let it brown or the whole dish turns bitter.</p>' +
      '<p>Add the soy sauce and sugar, and let it bubble for thirty seconds.</p>' +
      '<p>Toss the noodles through with a splash of the reserved water, until everything is glossy. Finish with spring onions and chilli.</p>',
    author: 'bilal-uid',
    authorName: 'Bilal Khan',
    authorEmail: 'bilal@example.com',
    tags: ['quick', 'vegetarian', 'dinner'],
    servings: 2,
    prepMinutes: 5,
    cookMinutes: 10,
    difficulty: 'easy',
    cuisine: 'Chinese',
    ratings: [
      { userId: 'demo-user', score: 4 },
      { userId: 'sara-uid', score: 5 },
      { userId: 'amina-uid', score: 4 },
    ],
    comments: [
      { text: 'My default after a late shift. Never fails.', authorId: 'sara-uid', authorName: 'Sara Ahmed' },
    ],
  },
  {
    title: 'Slow-Braised Beef Nihari',
    image: IMG('6210959'),
    overview:
      'An overnight braise that rewards patience and nothing else. Start it the evening before and finish it for breakfast, as it is meant to be eaten.',
    ingredients: [
      { amount: '1.5 kg', name: 'beef shank, in large pieces' },
      { amount: '150 g', name: 'ghee' },
      { amount: '2', name: 'onions, thinly sliced' },
      { amount: '3 tbsp', name: 'nihari masala' },
      { amount: '4 tbsp', name: 'wholemeal flour' },
      { amount: '2 litres', name: 'water' },
      { amount: 'to serve', name: 'ginger, lemon and green chilli' },
    ],
    instructions:
      '<p>Brown the onions in the ghee slowly, over twenty minutes, until deeply coloured but not burnt.</p>' +
      '<p>Add the beef and the masala and fry until the meat is sealed on all sides.</p>' +
      '<p>Pour in the water, bring to a bare simmer, cover, and leave on the lowest possible heat for six to eight hours. Overnight is better.</p>' +
      '<p>Whisk the flour into a little cold water until smooth, then stir it into the pot. Simmer uncovered for thirty minutes until the gravy thickens and glosses.</p>' +
      '<p>Serve with ginger, lemon and chilli on the side, and naan to push it around with.</p>',
    author: 'amina-uid',
    authorName: 'Amina Raza',
    authorEmail: 'amina@example.com',
    tags: ['dinner', 'slow-cooked', 'beef'],
    servings: 6,
    prepMinutes: 30,
    cookMinutes: 480,
    difficulty: 'hard',
    cuisine: 'Pakistani',
    ratings: [{ userId: 'bilal-uid', score: 5 }],
    comments: [],
  },
  {
    title: 'Grandmother’s Rice Pudding',
    image: IMG('3026804'),
    overview:
      'The recipe as it was written down, which is to say without a single number attached to the timing. You will know when it is done.',
    ingredients: [
      { amount: '100 g', name: 'pudding rice' },
      { amount: '1 litre', name: 'whole milk' },
      { amount: '75 g', name: 'sugar' },
      { amount: 'a knob', name: 'butter' },
      { amount: 'a good grating', name: 'nutmeg' },
    ],
    instructions:
      '<p>Butter a dish and tip in the rice and sugar.</p>' +
      '<p>Pour over the milk and stir once. Grate nutmeg across the top with a heavy hand.</p>' +
      '<p>Bake very low, undisturbed, until a brown skin has formed and the rice underneath is soft and swollen. This takes as long as it takes.</p>',
    author: 'sara-uid',
    authorName: 'Sara Ahmed',
    authorEmail: 'sara@example.com',
    tags: ['dessert', 'comfort'],
    // Deliberately unstated, so the "no time given" path is visible in the UI
    // and this recipe is correctly excluded from time filters.
    servings: 4,
    prepMinutes: null,
    cookMinutes: null,
    difficulty: null,
    cuisine: 'British',
    ratings: [
      { userId: 'demo-user', score: 5 },
      { userId: 'amina-uid', score: 5 },
      { userId: 'bilal-uid', score: 5 },
    ],
    comments: [
      {
        text: 'Two hours at 140°C, for anyone who wants a number. But she was right, you can see when it is ready.',
        authorId: 'demo-user',
        authorName: 'You',
      },
    ],
  },
  {
    title: 'Charred Aubergine with Yoghurt',
    image: IMG('1618898'),
    overview: 'Blistered whole over a flame, then dressed while still warm so it drinks up the lemon.',
    ingredients: [
      { amount: '2', name: 'large aubergines' },
      { amount: '200 g', name: 'thick yoghurt' },
      { amount: '1', name: 'garlic clove, crushed' },
      { amount: '1 1/2 tbsp', name: 'lemon juice' },
      { amount: '3 tbsp', name: 'olive oil' },
      { amount: '2 tbsp', name: 'pomegranate seeds' },
      { amount: 'to taste', name: 'salt and black pepper' },
    ],
    instructions:
      '<p>Char the aubergines whole, directly on a gas flame or under a very hot grill, turning until the skin is black all over and the flesh has slumped.</p>' +
      '<p>Leave them in a bowl covered with a plate for ten minutes — the steam loosens the skin.</p>' +
      '<p>Peel, tear the flesh into strips and season while warm.</p>' +
      '<p>Mix the yoghurt with the garlic and lemon. Spread on a plate, pile the aubergine on top, and finish with oil and pomegranate.</p>',
    author: 'sara-uid',
    authorName: 'Sara Ahmed',
    authorEmail: 'sara@example.com',
    tags: ['vegetarian', 'starter', 'quick'],
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 20,
    difficulty: 'easy',
    cuisine: 'Levantine',
    ratings: [
      { userId: 'amina-uid', score: 4 },
      { userId: 'demo-user', score: 5 },
    ],
    comments: [],
  },
  {
    title: 'Sourdough Focaccia',
    image: IMG('1775043'),
    overview: 'A long, cold ferment and very wet dough. Almost no work, spread across two days.',
    ingredients: [
      { amount: '500 g', name: 'strong white flour' },
      { amount: '400 ml', name: 'water' },
      { amount: '100 g', name: 'active sourdough starter' },
      { amount: '12 g', name: 'fine salt' },
      { amount: '4-5 tbsp', name: 'olive oil' },
      { amount: 'a scattering', name: 'rosemary and flaky salt' },
    ],
    instructions:
      '<p>Mix the flour and water and leave for an hour.</p>' +
      '<p>Add the starter and salt, working them through with wet hands until fully combined.</p>' +
      '<p>Fold the dough over itself four times, at half-hour intervals, then cover and refrigerate overnight.</p>' +
      '<p>Tip into a well-oiled tray, dimple all over with your fingertips, and leave for two to three hours until visibly puffed.</p>' +
      '<p>Scatter with rosemary and flaky salt, and bake at 230°C for twenty to twenty-five minutes until deeply golden.</p>',
    author: 'demo-user',
    authorName: 'You',
    authorEmail: 'you@example.com',
    tags: ['baking', 'bread', 'vegetarian'],
    servings: 10,
    prepMinutes: 40,
    cookMinutes: 25,
    difficulty: 'hard',
    cuisine: 'Italian',
    ratings: [{ userId: 'sara-uid', score: 5 }],
    comments: [
      {
        text: 'The overnight cold ferment makes all the difference. Do not skip it.',
        authorId: 'sara-uid',
        authorName: 'Sara Ahmed',
      },
    ],
  },
  {
    title: 'Masala Omelette',
    image: IMG('824635'),
    overview: 'Breakfast in under ten minutes, hot enough to wake you up properly.',
    ingredients: [
      { amount: '3', name: 'eggs' },
      { amount: '1/2', name: 'onion, finely diced' },
      { amount: '1', name: 'green chilli, chopped' },
      { amount: '1/4 tsp', name: 'turmeric' },
      { amount: '1 tbsp', name: 'butter' },
      { amount: 'a few sprigs', name: 'coriander' },
    ],
    instructions:
      '<p>Beat the eggs with the turmeric and a good pinch of salt.</p>' +
      '<p>Soften the onion and chilli in the butter for two minutes.</p>' +
      '<p>Pour in the eggs, pull the setting edges into the middle a few times, then leave it alone until just set.</p>' +
      '<p>Fold, slide onto a plate, and scatter with coriander.</p>',
    author: 'bilal-uid',
    authorName: 'Bilal Khan',
    authorEmail: 'bilal@example.com',
    tags: ['breakfast', 'quick', 'vegetarian'],
    servings: 1,
    prepMinutes: 5,
    cookMinutes: 5,
    difficulty: 'easy',
    cuisine: 'Indian',
    ratings: [
      { userId: 'demo-user', score: 4 },
      { userId: 'amina-uid', score: 4 },
    ],
    comments: [],
  },
];
