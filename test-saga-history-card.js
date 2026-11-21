
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sharp = require('sharp');

async function main() {
  const indexPath = path.join(__dirname, 'index.js');
  const source = fs.readFileSync(indexPath, 'utf8');

  const startMarker = 'async function createSagaHistoryCard(';
  const endMarker = '// Creates one contact-sheet collage';

  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  if (start === -1 || end === -1) {
    throw new Error(
      'Could not locate the Saga History renderer in index.js.'
    );
  }

  const rendererSource = source.slice(start, end).trim();

  const fallbackAvatar = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg"
         width="180" height="180">
      <circle cx="90" cy="90" r="90" fill="#52625c"/>
      <text x="90" y="105"
            text-anchor="middle"
            fill="#f3f0e8"
            font-size="54"
            font-family="sans-serif">IW</text>
    </svg>
  `);

  const sandbox = {
    sharp,
    Resvg: require('@resvg/resvg-js').Resvg,
    Buffer,
    console,
    __dirname,
    escapeSvgText(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    },
    fetchSagaHistoryAvatar: async () => fallbackAvatar,
    require(name) {
      if (name === 'path' || name === 'fs') {
        return require(name);
      }

      throw new Error(`Unexpected module requested: ${name}`);
    }
  };

  const createSagaHistoryCard = vm.runInNewContext(
    rendererSource + '\ncreateSagaHistoryCard',
    sandbox
  );

  const honors = [
    {
      display_name: 'Conversion Ward',
      icon_path: 'assets/honors/Conversion ward.png',
      count: 1
    },
    {
      display_name: 'Rune',
      icon_path: 'assets/honors/Rune.png',
      count: 3
    },
    {
      display_name: 'Gem',
      icon_path: 'assets/honors/Gem.png',
      count: 1
    },
    {
      display_name: 'Fang Necklace',
      icon_path: 'assets/honors/Fang Necklace.png',
      count: 1
    },
    {
      display_name: 'Talisman',
      icon_path: 'assets/honors/Talisman.png',
      count: 2
    },
    {
      display_name: 'Crux Terminatus',
      icon_path: 'assets/honors/Crux Terminatus.png',
      count: 1
    }
  ];

  const cardBuffer = await createSagaHistoryCard({
    displayName: 'Saga History Test Member',
    rankName: 'High Rune Priest',
    packName: 'Stormfangs, Rune Priesthood ',
    avatarUrl: null,
    sagaPoints: 1250,
    geneSeedTotal: 12,
    armouryDataTotal: 4750,
    tenure: '1 Year, 2 Months',
    honorLayout: {
      leftColumn: honors.slice(0, 5),
      rightColumn: honors.slice(5)
    }
  });

  const outputPath = path.join(
    __dirname,
    'saga-history-test.png'
  );

  await sharp(cardBuffer).png().toFile(outputPath);

  console.log('Saga History test card generated successfully.');
  console.log(`Output: ${outputPath}`);
  console.log('Discord connection: none');
  console.log('Database changes: none');
}

main().catch(error => {
  console.error('Saga History test failed:', error);
  process.exitCode = 1;
});