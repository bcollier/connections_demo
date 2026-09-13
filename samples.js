// Built-in sample puzzles so the hosted demo plays with no server and no API key.
// They mirror the shape of what the AI generator returns (see server/index.js).
window.SAMPLE_PUZZLES = [
  {
    title: 'Pittsburgh starter pack',
    categories: [
      { label: 'PITTSBURGH RIVERS', words: ['ALLEGHENY', 'MONONGAHELA', 'OHIO', 'YOUGHIOGHENY'], color: 'Yellow',
        explanation: 'Three rivers meet at the Point, and the fourth feeds the Mon from the south.' },
      { label: 'STEEL CITY EATS', words: ['PIEROGI', 'PRIMANTI', 'CHIPPED HAM', 'KIELBASA'], color: 'Green',
        explanation: 'Sandwiches with fries inside and deli counters with chipped ham. Local comfort food.' },
      { label: 'PITTSBURGHESE', words: ['YINZ', 'NEBBY', 'JAGOFF', 'GUMBAND'], color: 'Blue',
        explanation: 'Dialect words a newcomer learns in the first week, whether they want to or not.' },
      { label: 'THINGS WITH BRIDGES', words: ['GUITAR', 'NOSE', 'DENTIST', 'CARD GAME'], color: 'Purple',
        explanation: 'Pittsburgh has 446 bridges, but these have bridges too: guitars, noses, dental work, and the game of bridge.' },
    ],
    explanation: 'A puzzle for anyone who has crossed the Fort Pitt Bridge and gasped at the skyline. It starts easy with the rivers, warms up with the food, and finishes with a bit of wordplay.',
    recommendations: [
      { title: 'Pittsburgh bridges, by the numbers', url: 'https://en.wikipedia.org/wiki/List_of_bridges_of_Pittsburgh', type: 'article' },
    ],
  },
  {
    title: 'Data science happy hour',
    categories: [
      { label: 'MODEL EVALUATION METRICS', words: ['PRECISION', 'RECALL', 'ACCURACY', 'F1'], color: 'Yellow',
        explanation: 'The four numbers everyone quotes from a confusion matrix.' },
      { label: 'PYTHON DATA STACK', words: ['PANDAS', 'NUMPY', 'POLARS', 'SCIKIT'], color: 'Green',
        explanation: 'Libraries you import before you have finished your coffee.' },
      { label: 'SQL WINDOW FUNCTIONS', words: ['LAG', 'LEAD', 'RANK', 'NTILE'], color: 'Blue',
        explanation: 'Analytic functions that look at neighboring rows without collapsing them.' },
      { label: 'HIDDEN COFFEE ORDERS', words: ['LATTICE', 'DRIPPING', 'HICCUP', 'BEANSTALK'], color: 'Purple',
        explanation: 'Each word hides something from the coffee counter: latte, drip, cup, and bean.' },
    ],
    explanation: 'Built for a data person who teaches by day and tinkers by night. Two categories are straight from the toolbox, one rewards knowing your SQL, and the purple group hides coffee orders inside longer words.',
    recommendations: [
      { title: 'Precision and recall, explained', url: 'https://en.wikipedia.org/wiki/Precision_and_recall', type: 'article' },
      { title: 'Window functions in PostgreSQL', url: 'https://www.postgresql.org/docs/current/tutorial-window.html', type: 'article' },
    ],
  },
  {
    title: 'Weekend mode',
    categories: [
      { label: 'CLASSIC ARCADE GAMES', words: ['PAC-MAN', 'GALAGA', 'FROGGER', 'CENTIPEDE'], color: 'Yellow',
        explanation: 'Quarter-eaters from the golden age of the arcade.' },
      { label: 'BACKYARD LAWN GAMES', words: ['CORNHOLE', 'CROQUET', 'BOCCE', 'HORSESHOES'], color: 'Green',
        explanation: 'Games that get more competitive after the second lemonade.' },
      { label: 'WAYS TO WORK OUT', words: ['ROW', 'CYCLE', 'SWIM', 'CLIMB'], color: 'Blue',
        explanation: 'Verbs that double as whole sports and, awkwardly, as other words entirely.' },
      { label: 'ANAGRAMS OF EACH OTHER', words: ['LISTEN', 'SILENT', 'TINSEL', 'ENLIST'], color: 'Purple',
        explanation: 'Same six letters, four different words.' },
    ],
    explanation: 'A lighter puzzle for a Saturday. Arcade cabinets, lawn games, gym verbs, and a purple group that is one word rearranged four ways.',
    recommendations: [
      { title: 'Golden age of arcade video games', url: 'https://en.wikipedia.org/wiki/Golden_age_of_arcade_video_games', type: 'article' },
    ],
  },
];
