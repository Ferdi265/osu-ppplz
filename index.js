var //Requires
	osuapi = require('osu-api'),
	async = require('async');

module.exports = function (key) {
	var inst = new process.EventEmitter(),
		osu = new osuapi.Api(key),
		watching = {},
		//Private Functions
		accuracy = function (score) {
			var hitscore = parseInt(score.count300, 10) * 300 + parseInt(score.count100, 10) * 100 + parseInt(score.count50, 10) * 50,
				hitcount = parseInt(score.count300, 10) + parseInt(score.count100, 10) + parseInt(score.count50, 10) + parseInt(score.countmiss, 10);
			return hitscore / (hitcount * 300) * 100;
		},
		scoresEqual = function (score1, score2) {
			return score1.score === score2.score &&
				score1.maxcombo === score2.maxcombo &&
				score1.count50 === score2.count50 &&
				score1.count100 === score2.count100 &&
				score1.count300 === score2.count300 &&
				score1.countkatu === score2.countkatu &&
				score1.countgeki === score2.countgeki &&
				score1.perfect === score2.perfect &&
				score1.enabled_mods === score2.enabled_mods;
		},
		decorateScore = function (current, score) {
			var scoreAccuracy = accuracy(current);
			if (score && scoresEqual(current, score)) {
				score.pp = parseInt(score.pp, 10);
				score.accuracy = scoreAccuracy;
				score.beatmap_id = current.beatmap_id;
				score.pb = true;
				return score;
			} else {
				current.accuracy = scoreAccuracy;
				current.pb = false;
				return current;
			}
		},
		decorateUser = function (userData, user) {
			var relativePP = parseInt(user.pp_raw, 10) - userData.pp,
				relativeRank = parseInt(user.pp_rank, 10) - userData.rank;
			userData.pp = parseInt(user.pp_raw, 10);
			userData.rank = parseInt(user.pp_rank, 10);
			user.pp = userData.pp;
			user.rank = userData.rank;
			user.relative_pp = relativePP;
			user.relative_rank = relativeRank;
			return user;
		},
		watch = function (userData) {
			if (!userData.id) {
				async.parallel({
					recentPlays: osu.getUserRecent.bind(osu, userData.user),
					user: osu.getUser.bind(osu, userData.user)
				}, function (err, result) {
					if (err) {
						inst.unwatch(userData.user);
						userData.cb(err);
					} else {
						userData.id = parseInt(result.user.user_id, 10);
						userData.pp = parseInt(result.user.pp_raw, 10);
						userData.rank = parseInt(result.user.pp_rank, 10);
						userData.recent = result.recentPlays[0];
						setTimeout(watch.bind(undefined, userData), 2000);
					}
				});
			} else {
				osu.getUserRecent(userData.id, function (err, recentPlays) {
					if (err) {
						inst.unwatch(userData.user);
						userData.cb(err);
					} else {
						if (userData.recent && recentPlays[0] && !scoresEqual(userData.recent, recentPlays[0])) {
							var current = recentPlays[0];
							userData.recent = current;
							async.parallel({
								score: getScore.bind(undefined, current.beatmap_id, userData.id),
								user: osu.getUser.bind(osu, userData.id)
							}, function (err, result) {
								if (err) {
									inst.unwatch(userData.user);
									userData.cb(err);
								} else {
									var score = decorateScore(current, result.score),
										user = decorateUser(userData, result.user);
									userData.cb(null, {
										score: score,
										user: user,
									});
									setTimeout(watch.bind(undefined, userData), 2000);
								}
							});
						} else {
							setTimeout(watch.bind(undefined, userData), 2000);
						}
					}
				});
			}
		},
		getScore = function (beatmapId, userId, cb) {
			osu.getUserScore(beatmapId, userId, function (err, score) {
				if (err) {
					cb(err);
				} else {
					if (!score || score.pp !== null) {
						cb(null, score);
					} else {
						setTimeout(getScore.bind(undefined, beatmapId, userId, cb), 2000);
					}
				}
			});
		};
	inst.osu = osu;
	inst.watch = function (user, cb) {
		if (!watching[user]) {
			watching[user] = {
				cb: cb,
				user: user
			};
			watching[user].timeout = setTimeout(watch.bind(undefined, watching[user]), 0);
		}
	};
	inst.watching = function (user) {
		return Boolean(watching[user]);
	};
	inst.unwatch = function (user) {
		if (watching[user]) {
			clearTimeout(watching[user].timeout);
			delete watching[user];
		}
	};
	inst.lastScore = function (user, cb) {
		async.parallel({
			recent: osu.getUserRecent.bind(osu, user),
			user: osu.getUser.bind(osu, user)
		}, function (err, result) {
			if (err || !result.recent[0]) {
				cb(err);
			} else {
				getScore(result.recent[0].beatmap_id, result.user.user_id, function (err, score) {
					if (err) {
						cb(err);
					} else {
						cb(null, decorateScore(result.recent[0], score));

					}
				});
			}
		});
	};
	return inst;
};