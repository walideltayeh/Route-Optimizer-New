// Lesson cards (content owned by me.js). One unlocks per completed session; all are open after 10 sessions.
// Order and titles match today.js. Copy rules: cautious, no outcome promises, calories only as estimates.

export const LESSONS = [
  {
    id: 'incline',
    title: 'Why incline works',
    minutes: 2,
    body: `<p>Walking uphill asks your legs to lift your body as well as carry it forward. That extra work raises your heart rate and the energy you use without making you go faster. A few percent of incline can turn an easy walk into a real workout while your feet still land at walking pace, which many people find kinder to their joints than running.</p>
<p>The standard ACSM walking equation shows the effect. At 5 km/h (3.1 mph), walking at a 10% incline uses well over twice the active energy of walking on the flat. Like every figure in Hillpace, that is an estimate.</p>
<p>Climbing also works your calves, hamstrings and glutes harder than flat walking. That is why your plan raises the incline a little at a time: calves and Achilles tendons need a few weeks to get used to steeper slopes. If the back of your heel or calf feels sore, stay at a lower incline for a few more sessions.</p>`,
    source: 'ACSM’s Guidelines for Exercise Testing and Prescription; CDC physical activity guidance.',
  },
  {
    id: 'effort',
    title: 'Effort and the talk test',
    minutes: 2,
    body: `<p>You don’t need a heart-rate monitor to judge effort. The talk test is a simple guide: during moderate activity you can talk but not sing, and during vigorous activity you can only say a few words before you need a breath.</p>
<p>Hillpace uses a 1 to 10 effort scale with the same anchors:</p>
<ul><li><b>3–4:</b> you can talk in full sentences</li><li><b>5–6:</b> short phrases only</li><li><b>7–8:</b> a few words at a time</li><li><b>9–10:</b> you can’t talk</li></ul>
<p>Climbs and power walks should feel like 5 to 7. Recoveries should bring you back to 3 or 4 so you can work hard again. After each workout you rate the whole session. If two sessions in a row feel very hard, your plan eases off. If two feel easy, it offers a small step up, and you decide. Rate honestly: there is no prize for a high number.</p>`,
    source: 'CDC, Measuring physical activity intensity; WHO guidelines on physical activity (2020).',
  },
  {
    id: 'warmup',
    title: 'Warm-up and cool-down',
    minutes: 2,
    body: `<p>Every Hillpace workout starts with a few minutes of easy and brisk walking on a low incline, and ends the same way. The warm-up raises your heart rate and breathing gradually, warms your muscles and gives your calves and Achilles tendons time to adjust before the steeper work begins.</p>
<p>The cool-down lets your heart rate and breathing settle. Stopping suddenly after hard effort can leave some people light-headed, because blood pools in the legs when they stop moving. A few easy minutes on the belt helps prevent that.</p>
<p>Gentle calf and hip stretches afterwards can feel good, but they are optional. If you are short on time, shorten the main set rather than the warm-up: the 30-minute version on Today keeps both ends of the workout and still counts toward your week.</p>`,
    source: 'ACSM’s Guidelines for Exercise Testing and Prescription; NHS exercise guidance.',
  },
  {
    id: 'handrails',
    title: 'Handrails and form',
    minutes: 2,
    body: `<p>Holding the handrails on a steep incline takes part of your weight off your legs. Research on treadmill walking shows this lowers the real effort, so energy figures on a console or in an app can be well above what you actually used. If you usually hold on, turn off “I walk hands-free” in Me, then Treadmill, and Hillpace lowers its estimates on inclines of 8% and above.</p>
<p>A light touch for balance is fine. Good form on a slope looks like this:</p>
<ul><li>Stand tall and lean slightly forward from the ankles, not the waist.</li><li>Look ahead rather than down at your feet.</li><li>Take shorter steps as the slope gets steeper.</li><li>Let your arms swing naturally.</li></ul>
<p>If you can’t keep up without gripping the rails, lower the speed or incline instead. A setting you can walk hands-free is a better workout than a harder one you have to hang on to.</p>`,
    source: 'ACSM’s Guidelines for Exercise Testing and Prescription.',
  },
  {
    id: 'neat',
    title: 'Daily steps add up',
    minutes: 2,
    body: `<p>Your workouts fill a few hours a week. The rest of the day matters too. The energy you use in everyday movement, such as walking to the shops, taking the stairs, doing housework or standing while you take a call, has a name: non-exercise activity thermogenesis, or NEAT. It varies a lot between people, and it can quietly drop when you are tired or eating less.</p>
<p>Small habits help keep it up:</p>
<ul><li>Walk while you are on the phone.</li><li>Take a short walk after meals.</li><li>Get off one stop early, or park a little further away.</li><li>Stand up and move for a few minutes every hour you sit.</li></ul>
<p>The WHO advises limiting the time you spend sitting and replacing it with activity of any intensity. None of this needs a treadmill. On rest days, a relaxed walk outside keeps you moving without adding strain.</p>`,
    source: 'WHO guidelines on physical activity and sedentary behaviour (2020); CDC physical activity guidelines.',
  },
  {
    id: 'protein',
    title: 'Protein and appetite',
    minutes: 2,
    body: `<p>When you are eating a little less, what you eat matters as well as how much. Protein tends to be more filling than refined snacks, and getting enough of it alongside regular activity can help you hold on to muscle while you lose weight.</p>
<p>Some practical ideas:</p>
<ul><li>Include a protein food at each meal: eggs, yoghurt, fish, chicken, beans, lentils, tofu or lean meat.</li><li>Fill half your plate with vegetables or salad for volume and fibre.</li><li>Choose water or unsweetened drinks most of the time.</li><li>Feeling hungry after a workout is normal. A balanced meal usually satisfies better than a large snack.</li></ul>
<p>Hillpace doesn’t prescribe what to eat. If you have kidney disease, diabetes or another health condition, or you are unsure what suits you, ask your doctor or a registered dietitian.</p>`,
    source: 'NHS Eatwell Guide; WHO healthy diet guidance.',
  },
  {
    id: 'plateaus',
    title: 'Plateaus and water weight',
    minutes: 2,
    body: `<p>Body weight can swing by 1 kg (about 2 lb) or more from one day to the next. Salt, carbohydrate, hormones, how much you have drunk and what is still in your digestive system all move the scale. A new exercise routine can also make your muscles hold extra water for a while as they recover.</p>
<p>That is why Hillpace shows a smoothed trend instead of reacting to every weigh-in. The trend moves slowly and tells you more than any single day.</p>
<p>A real plateau is when the trend stays flat for three to four weeks. It is common, partly because a smaller body uses less energy. If it happens:</p>
<ul><li>Weigh in the same way each time: same time of day, before eating.</li><li>Look at your other progress: minutes, distance, climb and how you feel.</li><li>Consider a small change to your eating, or add more daily steps.</li></ul>
<p>Weighing in a few times a week works for many people, and so does not weighing in at all. You can hide weight figures at any time in Me.</p>`,
    source: 'NHS weight loss guidance; Hall KD et al., Lancet (2011).',
  },
  {
    id: 'sleep',
    title: 'Sleep and recovery',
    minutes: 2,
    body: `<p>Fitness improves between workouts, not during them. Your plan includes rest days and lighter weeks (weeks 4, 8 and 12) so your muscles, tendons and energy levels can catch up.</p>
<p>Sleep is part of recovery. Most adults need 7 or more hours a night. Short sleep is linked with more hunger and stronger cravings, and it makes the same workout feel harder.</p>
<p>Signs you may need more recovery:</p>
<ul><li>Sessions keep feeling harder than usual at the same settings.</li><li>Soreness lasts more than two or three days.</li><li>You sleep badly or feel run down.</li></ul>
<p>On those days, choose the easy walk or the 30-minute version, or take the day off. Never train through pain: sharp or worsening pain in a joint, calf or Achilles tendon is a reason to stop and get it checked.</p>`,
    source: 'CDC sleep guidance for adults; NHS advice on sleep and tiredness.',
  },
  {
    id: 'safety',
    title: 'Treadmill safety',
    minutes: 2,
    body: `<p>A few habits make treadmill walking much safer:</p>
<ul><li>Clip the safety key to your clothing every time. If you slip, it stops the belt.</li><li>Stand on the side rails to start the belt, then step on at a slow speed.</li><li>Hold the rails while you change speed or incline, then let go once you are steady.</li><li>Slow the belt right down before you step off, and never step off backwards.</li><li>Keep children and pets away, and leave clear space behind the treadmill.</li><li>Wear supportive shoes with the laces tied, and keep water within reach.</li></ul>
<p>Steep inclines load your calves and Achilles tendons. Build up over weeks, and lower the incline if the back of your heel or calf starts to hurt.</p>
<p><b>Stop the belt and seek care</b> if you feel chest pain or pressure, unusual breathlessness, dizziness, palpitations or nausea. Call your local emergency number if symptoms are severe.</p>`,
    source: 'ACSM’s Guidelines for Exercise Testing and Prescription; NHS exercise safety advice.',
  },
  {
    id: 'habit',
    title: 'Building the habit',
    minutes: 2,
    body: `<p>Lasting change comes from something you can repeat, not from one heroic week. A few things make workouts easier to keep doing:</p>
<ul><li><b>Anchor it.</b> Same days, same time, straight after something you already do, like getting home from work.</li><li><b>Make starting easy.</b> Leave your shoes by the treadmill and lay out your kit the night before.</li><li><b>Use the short version.</b> A 30-minute session still counts toward your week and keeps the habit going.</li><li><b>Count weeks, not days.</b> Missing one session doesn’t undo anything. Your streak counts weeks.</li><li><b>Expect setbacks.</b> Illness, travel and busy weeks happen. Pick up where you left off.</li></ul>
<p>Research suggests new habits take anywhere from a few weeks to several months to feel automatic, and it varies a lot from person to person. Keep going: the routine gets easier the more often you repeat it.</p>`,
    source: 'CDC physical activity guidelines; NHS Better Health.',
  },
];

export const lessonById = (id) => LESSONS.find((l) => l.id === id) || null;
