import { chromium } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const HOF_LINKS_PATH = path.resolve('scratch/hof_links.json');
const FIXTURE_OUT_PATH = path.resolve('fixtures/player-presentation/hof-players.fixture.json');

async function run() {
  if (!fs.existsSync(HOF_LINKS_PATH)) {
    console.error(`Error: HOF links file not found at ${HOF_LINKS_PATH}. Please run scratch/get-hof.ts first.`);
    process.exit(1);
  }

  const rawLinks = JSON.parse(fs.readFileSync(HOF_LINKS_PATH, 'utf-8'));
  console.log(`Loaded ${rawLinks.length} raw links from ${HOF_LINKS_PATH}`);

  // /players/로 시작하는 유효한 플레이어 프로필 링크 필터링
  const playerLinks = rawLinks.filter((item: any) => {
    return item.href && item.href.startsWith('/players/') && !item.href.includes('/poker-players/');
  });

  console.log(`Filtered down to ${playerLinks.length} potential player links`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const hofPlayers: any[] = [];

  for (const item of playerLinks) {
    const name = item.text.split('\n')[0].trim();
    const profileUrl = item.href;
    console.log(`Checking player: ${name} (${profileUrl})`);

    let isNonPlayer = false;
    let nameOverride = name;

    // 일부 알려진 비플레이어 기여자 예외 리스트
    const knownNonPlayers = [
      'benny binion',
      'jack mcclelland',
      'eric drache',
      'linda johnson',
      'mori eskandani',
      'henry orenstein',
      'jack binion'
    ];

    if (knownNonPlayers.includes(name.toLowerCase())) {
      isNonPlayer = true;
      console.log(`  -> Marked as non-player contributor (known list)`);
    } else {
      try {
        // 실제 wsop.com 페이지를 방문하여 프로필이 살아있는지 체크
        const response = await page.goto(`https://www.wsop.com${profileUrl}`, {
          waitUntil: 'domcontentloaded',
          timeout: 20000
        });

        // 5초간 대기하여 페이지 렌더링 확인 (안정적인 로드 유도)
        await page.waitForTimeout(3000);

        if (!response || response.status() === 404) {
          isNonPlayer = true;
          console.log(`  -> Marked as non-player: Response status is 404`);
        } else {
          // 'Page Not Found' 또는 'We could not find the player' 같은 문구가 있는지 확인
          const bodyText = await page.innerText('body');
          if (
            bodyText.includes('Page Not Found') ||
            bodyText.includes('404') ||
            bodyText.includes('could not find the player') ||
            bodyText.includes('Player Not Found')
          ) {
            isNonPlayer = true;
            console.log(`  -> Marked as non-player: Found 404/Error text in page body`);
          } else {
            // WSOP 스탯 테이블이나 cashes 같은 지표가 아예 비어있는지 확인
            // 비플레이어 기여자는 프로필은 있어도 지표가 다 0이거나 아예 테이블이 없음
            const statTableCount = await page.locator('.player-stats, table').count().catch(() => 0);
            if (statTableCount === 0 && !bodyText.includes('Cashes') && !bodyText.includes('Earnings')) {
              isNonPlayer = true;
              console.log(`  -> Marked as non-player: No stats or table found`);
            } else {
              // 실제 이름 갱신 로직 추가
              let realName = '';
              const h2Count = await page.locator('h2').count().catch(() => 0);
              for (let i = 0; i < h2Count; i++) {
                const text = await page.locator('h2').nth(i).innerText().catch(() => '');
                const clean = text.trim();
                if (clean && clean.length > 2 && !/Stats|Story|Staking|Results/i.test(clean)) {
                  realName = clean;
                  break;
                }
              }
              if (!realName) {
                const h1Count = await page.locator('h1').count().catch(() => 0);
                for (let i = 0; i < h1Count; i++) {
                  const text = await page.locator('h1').nth(i).innerText().catch(() => '');
                  const clean = text.trim();
                  if (clean && clean.length > 2 && !/Player Profile|Stats|Story|Staking/i.test(clean)) {
                    realName = clean;
                    break;
                  }
                }
              }

              if (realName && realName.trim().length > 2) {
                const cleanedName = realName.trim().split('\n')[0].trim();
                if (cleanedName.toLowerCase() !== name.toLowerCase()) {
                  console.log(`  -> Real displayName updated: ${name} -> ${cleanedName}`);
                }
                nameOverride = cleanedName;
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`  [경고] 페이지 접근 실패 (${name}): ${err.message}. Non-player 여부는 기본값으로 설정.`);
      }
    }

    const playerObj: any = {
      displayName: nameOverride,
      searchKeyword: name,
      profileUrl: profileUrl
    };

    if (isNonPlayer) {
      playerObj.knownExceptionKey = 'non-player';
    } else {
      // 기존에 존재하던 Phil Ivey, Daniel Negreanu, Phil Hellmuth 등의 예외 키 유지
      const lowerName = nameOverride.toLowerCase();
      if (lowerName.includes('phil ivey')) {
        playerObj.knownExceptionKey = 'phil-ivey';
      } else if (lowerName.includes('daniel negreanu')) {
        playerObj.knownExceptionKey = 'daniel-negreanu';
      } else if (lowerName.includes('phil hellmuth')) {
        playerObj.knownExceptionKey = 'phil-hellmuth';
      } else if (lowerName.includes('michael mizrachi')) {
        playerObj.knownExceptionKey = 'michael-mizrachi';
      } else if (lowerName.includes('nick schulman') || lowerName.includes('nicholas schulman')) {
        playerObj.knownExceptionKey = 'nick-schulman';
      }
    }

    hofPlayers.push(playerObj);
  }

  await browser.close();

  // 결과를 fixtures 폴더에 쓰기
  fs.mkdirSync(path.dirname(FIXTURE_OUT_PATH), { recursive: true });
  fs.writeFileSync(FIXTURE_OUT_PATH, JSON.stringify(hofPlayers, null, 2) + '\n', 'utf-8');
  console.log(`\nSuccessfully updated HOF players fixture to ${FIXTURE_OUT_PATH}`);
  console.log(`Total HOF Players: ${hofPlayers.length}`);
  console.log(`Non-players flagged: ${hofPlayers.filter(p => p.knownExceptionKey === 'non-player').length}`);
}

run().catch(console.error);
