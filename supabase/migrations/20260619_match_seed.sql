-- =============================================================================
-- Match feature — mock seed data for development & testing
-- 10 fake profiles to test the full match flow without real users.
-- Liu Y. (mock-liu-010) has visible_in_match=false to test invisibility.
-- Run: replace YOUR_TEST_UID with your real Firebase UID before executing.
-- =============================================================================

insert into profiles (
  id, first_name, display_name, gender, sports, skill, bio, city,
  photos, visible_in_match, latitude, longitude,
  pref_gender, pref_distance_km, pref_sports
) values
  ('mock-sarah-001', 'Sarah',  'Sarah K.',  'female', array['running','yoga'],             'Intermediate', 'Morning runner, yoga enthusiast. Looking for a 5am run buddy.',      'New York', array['https://randomuser.me/api/portraits/women/1.jpg'],  true,  40.7128, -74.0060, 'all', 25, '{}'),
  ('mock-alex-002',  'Alex',   'Alex M.',   'male',   array['cycling','triathlon'],        'Advanced',     'Cat 2 cyclist and Ironman finisher. Always training.',                'New York', array['https://randomuser.me/api/portraits/men/2.jpg'],    true,  40.7209, -73.9950, 'all', 25, '{}'),
  ('mock-mei-003',   'Mei',    'Mei L.',    'female', array['climbing','hiking'],          'Advanced',     'Rock climber and weekend hiker. V7 in the gym, Grade 5.11 outdoors.', 'New York', array['https://randomuser.me/api/portraits/women/3.jpg'],  true,  40.7282, -73.9942, 'all', 25, '{}'),
  ('mock-jordan-004','Jordan', 'Jordan T.', 'other',  array['running','hiit'],             'Beginner',     'Just started running this year. Doing my first 5K next month!',       'New York', array['https://randomuser.me/api/portraits/men/4.jpg'],    true,  40.7489, -73.9680, 'all', 25, '{}'),
  ('mock-chris-005', 'Chris',  'Chris B.',  'male',   array['swimming','open water'],      'Elite',        'Open water swimmer and coach. English Channel aspirant.',             'New York', array['https://randomuser.me/api/portraits/men/5.jpg'],    true,  40.7831, -73.9712, 'all', 25, '{}'),
  ('mock-rina-006',  'Rina',   'Rina O.',   'female', array['trail running','skiing'],     'Advanced',     'Trail runner and powder chaser. Happiest above treeline.',            'New York', array['https://randomuser.me/api/portraits/women/6.jpg'],  true,  40.7549, -74.0020, 'all', 25, '{}'),
  ('mock-tom-007',   'Tom',    'Tom H.',    'male',   array['gym','strength training'],    'Intermediate', 'Powerlifter. 3-2-1 is my philosophy. Gym is life.',                   'New York', array['https://randomuser.me/api/portraits/men/7.jpg'],    true,  40.7120, -74.0055, 'all', 25, '{}'),
  ('mock-priya-008', 'Priya',  'Priya S.',  'female', array['yoga','pilates'],             'Beginner',     'Yoga teacher, love the outdoors. Mornings and weekends only.',        'New York', array['https://randomuser.me/api/portraits/women/8.jpg'],  true,  40.7614, -73.9776, 'all', 25, '{}'),
  ('mock-diego-009', 'Diego',  'Diego R.',  'male',   array['soccer','basketball'],        'Intermediate', 'Weekend warrior, team sports guy. Always need one more player.',      'New York', array['https://randomuser.me/api/portraits/men/9.jpg'],    true,  40.6892, -74.0445, 'all', 25, '{}'),
  ('mock-liu-010',   'Liu',    'Liu Y.',    'female', array['running','cycling'],          'Advanced',     'Triathlete in training. Opted out of matching for now.',              'New York', array['https://randomuser.me/api/portraits/women/10.jpg'], false, 40.7308, -73.9973, 'all', 25, '{}')
on conflict (id) do update set
  first_name       = excluded.first_name,
  display_name     = excluded.display_name,
  gender           = excluded.gender,
  sports           = excluded.sports,
  skill            = excluded.skill,
  bio              = excluded.bio,
  city             = excluded.city,
  photos           = excluded.photos,
  visible_in_match = excluded.visible_in_match,
  latitude         = excluded.latitude,
  longitude        = excluded.longitude,
  pref_gender      = excluded.pref_gender,
  pref_distance_km = excluded.pref_distance_km,
  pref_sports      = excluded.pref_sports;

-- Sarah pre-likes YOUR_TEST_UID so the first like triggers an instant match.
-- Replace YOUR_TEST_UID with your real Firebase UID before running this line.
-- insert into swipes (swiper_id, swiped_id, direction)
-- values ('mock-sarah-001', 'YOUR_TEST_UID', 'right')
-- on conflict (swiper_id, swiped_id) do nothing;
