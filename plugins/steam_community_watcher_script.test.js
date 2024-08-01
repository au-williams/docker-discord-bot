import { formatAnnouncementDescription } from './steam_community_watcher_script.js';

describe('formatAnnouncementDescription', () => {
  test('returns truncated Krita announcement', () => {
    const payload = {
      contents: 'Hey Krita community!\n' +
                '\n' +
                "I'm glad to announce to you all today that Krita 5.2.3 (or 5.2.4 on Windows) is finally here for all of our Steam users after an unfortunate, but necessary, delay. \n" +
                '\n' +
                'Before I get into the details surrounding the brief delay, please check out our [url=https://krita.org/en/posts/2024/krita-5-2-3-released/]official 5.2.3 patch notes over on the Krita website[/url].\n' +
                '\n' +
                'As some of you may know, Krita 5.2.3 was meant to come out for all of our users a couple of weeks ago, and for a short amount of time it did, including right here on Steam. However, during the weekend just after release we started to get a deluge of helpful bug reports from community members letting us know that something was wrong as they were experiencing frequent crashes during normal use on Windows. These crashes were partly the result of our new developer "CI"--a system which automates building new versions for us--and have now been fixed.\n' +
                '\n' +
                "But, to put the bottom line on top, we don't ever want users facing frequent crashes with a stable release version. We genuinely try to care about your artwork [i]almost[/i] as much as you do, and part of that means creating a good and stable tool that won't crash and won't cause you to lose work.\n" +
                '\n' +
                `And so the best course of action as I saw it was to roll the entire update back to the previous stable version 5.2.2 for all of our Steam users, while setting 5.2.3 to be active on our beta branch where some of you who weren't running into problems may have continued to use it. As GabeN once said "Late is just for a little while. Suck is forever", right?\n` +
                '\n' +
                'Anyway, long story short, these crashes should be fixed and the latest stable Krita release should now really be equally stable across Linux, Mac, and Windows. The version numbers are slightly different (Windows is 5.2.4, while Linux and MacOS are 5.2.3), but I promise you they are effectively the same in terms of features and performance!\n' +
                '\n' +
                'Finally, as you might have known from our recent promotions here on Steam and elsewhere, this summer marked the 25th anniversary of the Krita project! Thank you so much to all of you who have enjoyed and supported Krita in various ways over the years. \n' +
                '\n' +
                'Krita is, at its core, a community-driven open source project, and none of this would have been even remotely possible had it not been for all of the people who have put something into it, from code, to money, to constructive feedback and interesting new ideas.\n' +
                '\n' +
                'Sorry again for the short delay and thank you for all your support!\n' +
                'Emmet, on behalf of the whole Krita Dev Team.',
      title: 'Krita 5.2.3/4 is here and 25 years of Krita!'
    }

    expect(formatAnnouncementDescription(payload)).toBe("_Hey Krita community! I'm glad to announce to you all today that Krita 5.2.3 (or 5.2.4 on Windows) is finally here for all of [...]_");
  });
});