/**
 * Pangkalan data lagu & irama sebenar terbina dalam (tanpa API key).
 * Setiap lagu mengandungi:
 * - title, artist, aliases (termasuk variasi ejaan/typo biasa)
 * - moodKeywords (untuk pemadanan automatik bila lirik perlu disesuaikan)
 * - lang ('ms' atau 'en')
 * - tempo (BPM), style ('joget' | 'asli' | 'pop' | 'waltz' | 'march')
 * - phrases: 4 frasa nyanyian, setiap frasa ada lirik asal, nota melodi [note, beats], dan kord iringan
 */

const SONGS_DB = [
  {
    id: 'sua-sue-kemoning',
    title: 'Sua Sue Kemuning',
    artist: 'Tan Sri P. Ramlee, A.R. Tompel & Ibrahim Din (OST Nasib Do Re Mi)',
    aliases: [
      'sua sue kumoning',
      'sua sue kemoning',
      'sua sue kemuning',
      'suasue kemoning',
      'suasue kumoning',
      'suasue kemuning',
      'sua suae kemoning',
      'sua suwe kemoning',
      'istimewa raja',
      'limau purut lebat di dahan',
      'lapar perut dapat ku tahan',
    ],
    moodKeywords: ['bunga', 'kemuning', 'klasik', 'p ramlee', 'lapar', 'do re mi', 'raja'],
    lang: 'ms',
    tempo: 122,
    style: 'joget',
    phrases: [
      {
        text: 'Sua sue kemuning, sua sue kemuning',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 0.5], ['G4', 0.5],
          ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 1.0],
        ],
      },
      {
        text: 'Sua sue kemuning, istimewa raja',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 0.5], ['D4', 0.5],
          ['E4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['C5', 1.0],
        ],
      },
      {
        text: 'Limau purut lebat di dahan, batang selasih condong uratnya',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['A4', 0.5], ['A4', 0.5], ['C5', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 0.5],
          ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 0.5], ['D4', 1.0],
        ],
      },
      {
        text: 'Lapar perut dapat ku tahan, hati sakit apakah ubatnya',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['E4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 0.5], ['D4', 0.5],
          ['E4', 0.5], ['G4', 0.5], ['E4', 0.5], ['D4', 0.5], ['C4', 1.5],
        ],
      },
    ],
  },
  {
    id: 'rasa-sayang',
    title: 'Rasa Sayang (Rasa Sayange)',
    artist: 'Lagu Rakyat Nusantara',
    aliases: [
      'rasa sayang',
      'rasa sayange',
      'rasa sayang hey',
      'rasa sayang eh',
      'lihat nona jauh',
      'buah cempedak di luar pagar',
    ],
    moodKeywords: ['sayang', 'cinta', 'kasih', 'rindu', 'hati', 'jom', 'kawan', 'makan'],
    lang: 'ms',
    tempo: 118,
    style: 'joget',
    phrases: [
      {
        text: 'Rasa sayang hey, rasa sayang sayang hey',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['G4', 0.5], ['E4', 0.5], ['G4', 0.5], ['C5', 1.0], ['B4', 0.5],
          ['A4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 1.5],
        ],
      },
      {
        text: 'Hey lihat nona jauh, rasa sayang sayang hey',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['D4', 0.5], ['F4', 0.5], ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 0.5],
          ['D4', 0.5], ['E4', 0.5], ['F4', 0.5], ['E4', 1.5],
        ],
      },
      {
        text: 'Buah cempedak di luar pagar, ambil galah tolong jolokkan',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['C5', 0.5], ['C5', 0.5], ['B4', 0.5], ['A4', 0.5], ['G4', 0.5], ['A4', 0.5],
          ['G4', 0.5], ['F4', 0.5], ['E4', 1.0], ['G4', 1.0],
        ],
      },
      {
        text: 'Saya budak baru belajar, kalau salah tolong tunjukkan',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 0.5], ['D4', 0.5], ['E4', 0.5],
          ['F4', 0.5], ['D4', 0.5], ['C4', 2.0],
        ],
      },
    ],
  },
  {
    id: 'burung-kakak-tua',
    title: 'Burung Kakak Tua',
    artist: 'Lagu Rakyat Tradisional',
    aliases: [
      'burung kakak tua',
      'burong kakak tua',
      'hinggap di jendela',
      'nenek sudah tua',
      'giginya tinggal dua',
      'trek dung',
    ],
    moodKeywords: ['burung', 'terbang', 'rumah', 'nenek', 'tua', 'lucu', 'kelakar'],
    lang: 'ms',
    tempo: 110,
    style: 'waltz',
    phrases: [
      {
        text: 'Burung kakak tua, hinggap di jendela',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['G4', 1.0], ['E4', 0.5], ['G4', 0.5], ['C5', 1.0],
          ['A4', 1.0], ['G4', 0.5], ['E4', 0.5], ['G4', 1.0],
        ],
      },
      {
        text: 'Nenek sudah tua, giginya tinggal dua',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['F4', 1.0], ['D4', 0.5], ['F4', 0.5], ['A4', 1.0],
          ['G4', 1.0], ['F4', 0.5], ['D4', 0.5], ['E4', 1.0],
        ],
      },
      {
        text: 'Trek dung trek dung trek dung la la la',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['C5', 0.5], ['C5', 0.5], ['B4', 0.5], ['A4', 0.5], ['G4', 1.0],
          ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 1.5],
        ],
      },
      {
        text: 'Burung kakak tua, menyanyi dengan gembira',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 1.0],
          ['D4', 0.5], ['E4', 0.5], ['C4', 2.0],
        ],
      },
    ],
  },
  {
    id: 'chan-mali-chan',
    title: 'Chan Mali Chan',
    artist: 'Lagu Rakyat Melayu',
    aliases: [
      'chan mali chan',
      'can mali can',
      'chan malichan',
      'di mana dia anak kambing saya',
      'anak kambing tuan',
      'hoi hoi',
    ],
    moodKeywords: ['cari', 'mana', 'hilang', 'kambing', 'gembira', 'seronok', 'kerja', 'lapar'],
    lang: 'ms',
    tempo: 124,
    style: 'joget',
    phrases: [
      {
        text: 'Di mana dia anak kambing saya',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['G4', 0.5], ['C5', 0.5], ['C5', 0.5], ['C5', 0.5], ['C5', 0.5],
          ['B4', 0.5], ['A4', 0.5], ['G4', 1.0], ['E4', 0.5],
        ],
      },
      {
        text: 'Anak kambing tuan ada di kampung baru',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['A4', 0.5], ['A4', 0.5], ['A4', 0.5], ['G4', 0.5], ['F4', 0.5],
          ['E4', 0.5], ['D4', 0.5], ['E4', 1.0], ['G4', 0.5],
        ],
      },
      {
        text: 'Chan mali chan hoi hoi, chan mali chan hoi hoi',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['C5', 0.5], ['C5', 0.5], ['C5', 0.5], ['A4', 0.5], ['G4', 0.5],
          ['B4', 0.5], ['B4', 0.5], ['B4', 0.5], ['A4', 0.5], ['G4', 0.5],
        ],
      },
      {
        text: 'Chan mali chan ketipung payung',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 0.5],
          ['D4', 0.5], ['E4', 0.5], ['C4', 2.0],
        ],
      },
    ],
  },
  {
    id: 'lenggang-kangkung',
    title: 'Lenggang Kangkung',
    artist: 'Lagu Rakyat Melayu',
    aliases: [
      'lenggang kangkung',
      'lengang kangkong',
      'lenggang kangkong',
      'kangkung tepi telaga',
      'balik dari menyabung',
    ],
    moodKeywords: ['jalan', 'santai', 'kampung', 'sayur', 'masak', 'makan', 'lepak'],
    lang: 'ms',
    tempo: 116,
    style: 'joget',
    phrases: [
      {
        text: 'Lenggang lenggang kangkung, kangkung tepi telaga',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['E4', 0.5], ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 1.0],
          ['E4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 1.0],
        ],
      },
      {
        text: 'Balik dari menyabung, makan nasi bersama',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['A4', 0.5], ['C5', 0.5], ['B4', 0.5], ['A4', 0.5], ['G4', 1.0],
          ['F4', 0.5], ['E4', 0.5], ['D4', 0.5], ['E4', 0.5], ['C4', 1.0],
        ],
      },
      {
        text: 'Lenggang lenggang kangkung, kangkung di tepi sawah',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['D4', 0.5], ['F4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 1.0],
          ['F4', 0.5], ['E4', 0.5], ['D4', 0.5], ['E4', 0.5], ['G4', 1.0],
        ],
      },
      {
        text: 'Kalau hati dah bingung, mari kita bernyanyi',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['E4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 1.0],
          ['D4', 0.5], ['E4', 0.5], ['C4', 2.0],
        ],
      },
    ],
  },
  {
    id: 'enjit-enjit-semut',
    title: 'Enjit-Enjit Semut',
    artist: 'Lagu Rakyat Kanak-Kanak',
    aliases: [
      'enjit enjit semut',
      'enjit semut',
      'siapa sakit naik atas',
      'enjet enjet semut',
    ],
    moodKeywords: ['sakit', 'naik', 'main', 'kawan', 'bergurau', 'semut'],
    lang: 'ms',
    tempo: 120,
    style: 'march',
    phrases: [
      {
        text: 'Enjit enjit semut, siapa sakit naik atas',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['C4', 0.5], ['E4', 0.5], ['G4', 0.5], ['G4', 0.5], ['A4', 1.0],
          ['G4', 0.5], ['E4', 0.5], ['G4', 0.5], ['E4', 0.5], ['C4', 1.0],
        ],
      },
      {
        text: 'Enjit enjit semut, siapa sakit naik atas',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['F4', 0.5], ['A4', 0.5], ['C5', 0.5], ['C5', 0.5], ['B4', 1.0],
          ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 0.5], ['G4', 1.0],
        ],
      },
      {
        text: 'Mari kita main, bersama kawan semua',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['C5', 1.0],
          ['B4', 0.5], ['A4', 0.5], ['G4', 1.0], ['E4', 1.0],
        ],
      },
      {
        text: 'Enjit enjit semut, hati kita riang ria',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['E4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 0.5], ['D4', 0.5],
          ['C4', 0.5], ['D4', 0.5], ['C4', 2.0],
        ],
      },
    ],
  },
  {
    id: 'tanya-sama-pokok',
    title: 'Tanya Sama Pokok',
    artist: 'Lagu Rakyat Malaysia',
    aliases: [
      'tanya sama pokok',
      'apa sebab goyang',
      'nanti jawab pokok',
      'angin yang goncang',
      'tanya sama angin',
    ],
    moodKeywords: ['tanya', 'sebab', 'kenapa', 'hujan', 'angin', 'awan', 'pokok'],
    lang: 'ms',
    tempo: 114,
    style: 'pop',
    phrases: [
      {
        text: 'Tanya sama pokok, apa sebab goyang',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['E4', 0.5], ['E4', 0.5], ['G4', 0.5], ['G4', 0.5], ['A4', 1.0],
          ['G4', 0.5], ['E4', 0.5], ['D4', 1.0], ['E4', 1.0],
        ],
      },
      {
        text: 'Nanti jawab pokok, angin yang goncang',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['F4', 0.5], ['F4', 0.5], ['A4', 0.5], ['A4', 0.5], ['C5', 1.0],
          ['A4', 0.5], ['G4', 0.5], ['E4', 2.0],
        ],
      },
      {
        text: 'Tanya sama angin, apa sebab hujan',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['G4', 0.5], ['G4', 0.5], ['B4', 0.5], ['B4', 0.5], ['D5', 1.0],
          ['C5', 0.5], ['B4', 0.5], ['A4', 1.0], ['G4', 1.0],
        ],
      },
      {
        text: 'Nanti jawab angin, tanyalah awan',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 0.5],
          ['D4', 0.5], ['E4', 0.5], ['C4', 2.0],
        ],
      },
    ],
  },
  {
    id: 'bengawan-solo',
    title: 'Bengawan Solo',
    artist: 'Gesang',
    aliases: ['bengawan solo', 'riwayatmu ini', 'sedari dulu jadi perhatian insani'],
    moodKeywords: ['sungai', 'air', 'tenang', 'malam', 'syahdu', 'sedih', 'kenangan'],
    lang: 'ms',
    tempo: 92,
    style: 'asli',
    phrases: [
      {
        text: 'Bengawan Solo, riwayatmu ini',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['E4', 0.5], ['G4', 0.5], ['C5', 1.5], ['B4', 0.5],
          ['A4', 0.5], ['G4', 0.5], ['E4', 1.0], ['D4', 1.0],
        ],
      },
      {
        text: 'Sedari dulu jadi perhatian insani',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['F4', 0.5], ['A4', 0.5], ['C5', 1.0], ['B4', 0.5], ['A4', 0.5],
          ['G4', 0.5], ['F4', 0.5], ['E4', 2.0],
        ],
      },
      {
        text: 'Musim kemarau, tak seberapa airmu',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['D4', 0.5], ['F4', 0.5], ['A4', 1.0], ['G4', 0.5], ['F4', 0.5],
          ['E4', 0.5], ['D4', 0.5], ['E4', 1.0], ['G4', 1.0],
        ],
      },
      {
        text: 'Di musim hujan air meluap sampai jauh',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 0.5],
          ['D4', 0.5], ['E4', 0.5], ['C4', 2.0],
        ],
      },
    ],
  },
  {
    id: 'wau-bulan',
    title: 'Wau Bulan',
    artist: 'Lagu Rakyat Kelantan',
    aliases: ['wau bulan', 'eh wah bule', 'wah bule', 'wau bule teraju tiga'],
    moodKeywords: ['bulan', 'kelantan', 'terbang', 'dikir', 'tinggi', 'malam'],
    lang: 'ms',
    tempo: 118,
    style: 'joget',
    phrases: [
      {
        text: 'Eh wah bule, eh wah bule, wah bule teraju tiga',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['G4', 0.5], ['A4', 0.5], ['C5', 1.0], ['G4', 0.5], ['A4', 0.5], ['C5', 1.0],
          ['A4', 0.5], ['G4', 0.5], ['E4', 0.5], ['G4', 0.5], ['E4', 1.0],
        ],
      },
      {
        text: 'Ini male, samo-samo, samo-samo bersuka ria',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['A4', 0.5], ['C5', 0.5], ['D5', 1.0], ['C5', 0.5], ['A4', 0.5], ['G4', 1.0],
          ['E4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 1.5],
        ],
      },
      {
        text: 'Wau bulan terbang tinggi, menari di angkasa raya',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['G4', 0.5], ['A4', 0.5], ['B4', 0.5], ['C5', 0.5], ['D5', 1.0],
          ['C5', 0.5], ['B4', 0.5], ['A4', 1.0], ['G4', 1.0],
        ],
      },
      {
        text: 'Eh wah bule, hati gembira sepanjang masa',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['E4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 0.5],
          ['E4', 0.5], ['D4', 0.5], ['C4', 2.0],
        ],
      },
    ],
  },
  {
    id: 'balik-kampung',
    title: 'Balik Kampung',
    artist: 'Sudirman',
    aliases: ['balik kampung', 'balik kampong', 'hati girang', 'ho ho ho balik kampung'],
    moodKeywords: ['balik', 'kampung', 'raya', 'cuti', 'jalan', 'girang', 'kereta'],
    lang: 'ms',
    tempo: 126,
    style: 'pop',
    phrases: [
      {
        text: 'Perjalanan jauh tak ku rasa, kerna hati ku melonjak sama',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 1.0],
          ['G4', 0.5], ['A4', 0.5], ['C5', 1.0], ['A4', 1.0],
        ],
      },
      {
        text: 'Ingin berjumpa sanak saudara, yang selalu bermain di mata',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['A4', 0.5], ['C5', 0.5], ['C5', 0.5], ['B4', 0.5], ['A4', 1.0],
          ['G4', 0.5], ['F4', 0.5], ['E4', 1.0], ['G4', 1.0],
        ],
      },
      {
        text: 'Balik kampung, oh oh oh balik kampung',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['C5', 0.5], ['C5', 0.5], ['D5', 1.0], ['B4', 0.5], ['A4', 0.5], ['G4', 1.0],
          ['A4', 0.5], ['B4', 0.5], ['C5', 1.0],
        ],
      },
      {
        text: 'Balik kampung, hati girang',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['E4', 0.5],
          ['D4', 0.5], ['E4', 0.5], ['C4', 2.0],
        ],
      },
    ],
  },
  {
    id: 'selamat-hari-jadi',
    title: 'Selamat Hari Jadi (Happy Birthday)',
    artist: 'Lagu Sambutan Tradisional',
    aliases: [
      'selamat hari jadi',
      'selamat hari lahir',
      'happy birthday',
      'allah selamatkan kamu',
      'sanah helwah',
    ],
    moodKeywords: ['hari jadi', 'hari lahir', 'birthday', 'kek', 'tahniah', 'selamat'],
    lang: 'ms',
    tempo: 108,
    style: 'waltz',
    phrases: [
      {
        text: 'Selamat hari jadi, selamat hari jadi',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['G4', 0.5], ['G4', 0.5], ['A4', 1.0], ['G4', 1.0], ['C5', 1.0], ['B4', 2.0],
        ],
      },
      {
        text: 'Allah selamatkan kamu, selamat hari jadi',
        chord: ['G3', 'B3', 'D4'],
        notes: [
          ['G4', 0.5], ['G4', 0.5], ['A4', 1.0], ['G4', 1.0], ['D5', 1.0], ['C5', 2.0],
        ],
      },
      {
        text: 'Semoga panjang umur, murah rezeki selalu',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['G4', 0.5], ['G4', 0.5], ['G5', 1.0], ['E5', 1.0], ['C5', 1.0], ['B4', 1.0], ['A4', 1.0],
        ],
      },
      {
        text: 'Selamat hari jadi kepada kamu',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['F5', 0.5], ['F5', 0.5], ['E5', 1.0], ['C5', 1.0], ['D5', 1.0], ['C5', 2.0],
        ],
      },
    ],
  },
  {
    id: 'twinkle-twinkle',
    title: 'Bintang Kecil / Twinkle Twinkle Little Star',
    artist: 'Lagu Klasik',
    aliases: ['twinkle twinkle', 'twinkle twinkle little star', 'bintang kecil', 'how i wonder'],
    moodKeywords: ['bintang', 'tidur', 'malam', 'langit', 'star', 'night', 'sleep'],
    lang: 'ms',
    tempo: 104,
    style: 'pop',
    phrases: [
      {
        text: 'Twinkle twinkle little star, how I wonder what you are',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['C4', 0.5], ['C4', 0.5], ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['A4', 0.5], ['G4', 1.0],
          ['F4', 0.5], ['F4', 0.5], ['E4', 0.5], ['E4', 0.5], ['D4', 0.5], ['D4', 0.5], ['C4', 1.0],
        ],
      },
      {
        text: 'Up above the world so high, like a diamond in the sky',
        chord: ['F3', 'A3', 'C4'],
        notes: [
          ['G4', 0.5], ['G4', 0.5], ['F4', 0.5], ['F4', 0.5], ['E4', 0.5], ['E4', 0.5], ['D4', 1.0],
          ['G4', 0.5], ['G4', 0.5], ['F4', 0.5], ['F4', 0.5], ['E4', 0.5], ['E4', 0.5], ['D4', 1.0],
        ],
      },
      {
        text: 'Twinkle twinkle little star, how I wonder what you are',
        chord: ['C3', 'E3', 'G3'],
        notes: [
          ['C4', 0.5], ['C4', 0.5], ['G4', 0.5], ['G4', 0.5], ['A4', 0.5], ['A4', 0.5], ['G4', 1.0],
          ['F4', 0.5], ['F4', 0.5], ['E4', 0.5], ['E4', 0.5], ['D4', 0.5], ['D4', 0.5], ['C4', 1.0],
        ],
      },
    ],
  },
];

module.exports = { SONGS_DB };
