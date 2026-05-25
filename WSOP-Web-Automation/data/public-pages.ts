export type PublicPage = {
  name: string;
  url: string;
  expectedTexts: string[];
};

export const publicPages: PublicPage[] = [
  {
    name: 'Home',
    url: '/',
    expectedTexts: ['Upcoming Tournaments', 'Latest News'],
  },
  {
    name: 'Tournament Schedule',
    url: '/schedule/',
    expectedTexts: ['Tournaments Schedule'],
  },
  {
    name: 'Player Standings',
    url: '/player-standings/',
    expectedTexts: ['Player Standings'],
  },
  {
    name: 'Player Search',
    url: '/player-search/',
    expectedTexts: ['Player Search'],
  },
  {
    name: 'Hall of Fame',
    url: '/hall-of-fame/',
    expectedTexts: ['Poker Hall of Fame', 'Hall of Fame'],
  },
  {
    name: 'News',
    url: '/news/',
    expectedTexts: ['Latest News'],
  },
];
