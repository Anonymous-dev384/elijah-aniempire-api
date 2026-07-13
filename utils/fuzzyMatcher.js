const { distance } = require('fastest-levenshtein'); // For Levenshtein distance
const natural = require('natural'); // For more advanced NLP features

const FuzzyMatcher = {
    // Clean title for comparison
    cleanTitle: (title) => {
        return title
            .toLowerCase()
            // Remove special characters
            .replace(/[^\w\s]/g, '')
            // Remove common anime terms
            .replace(/(season|part|cour|\bep\b|\bs\d\b)/g, '')
            // Remove multiple spaces
            .replace(/\s+/g, ' ')
            .trim();
    },

    // Calculate similarity score (0-1)
    getSimilarity: (title1, title2) => {
        const clean1 = FuzzyMatcher.cleanTitle(title1);
        const clean2 = FuzzyMatcher.cleanTitle(title2);
        
        // Get Levenshtein distance
        const maxLength = Math.max(clean1.length, clean2.length);
        const levenScore = 1 - (distance(clean1, clean2) / maxLength);
        
        // Get token similarity (words in common)
        const tokens1 = new Set(clean1.split(' '));
        const tokens2 = new Set(clean2.split(' '));
        const commonWords = [...tokens1].filter(word => tokens2.has(word));
        const tokenScore = commonWords.length / Math.max(tokens1.size, tokens2.size);
        
        // Combine scores (weighted average)
        return (levenScore * 0.6) + (tokenScore * 0.4);
    },

    // Find best match from array of candidates
    findBestMatch: (searchTitle, candidates, thresholdOrKeys = 0.5) => {
        let bestMatch = null;
        let bestScore = 0;
        
        let threshold = 0.5;
        let keys = ['name', 'title', 'title_english', 'title_romaji', 'title_japanese'];
        
        if (typeof thresholdOrKeys === 'number') {
            threshold = thresholdOrKeys;
        } else if (Array.isArray(thresholdOrKeys)) {
            keys = thresholdOrKeys;
        }

        for (const candidate of candidates) {
            if (!candidate) continue;
            
            // Try to find the first matching key that has a string value
            let candidateText = '';
            for (const key of keys) {
                if (candidate[key] && typeof candidate[key] === 'string') {
                    candidateText = candidate[key];
                    break;
                }
            }
            
            if (!candidateText) continue;

            const score = FuzzyMatcher.getSimilarity(searchTitle, candidateText);
            
            if (score > bestScore && score >= threshold) { 
                bestScore = score;
                bestMatch = candidate;
            }
        }

        return {
            match: bestMatch,
            score: bestScore
        };
    },

    // Handle alternative titles...
    // But since alt titles doesn't seem to be present in zoro info sect, am gonna ignore this for now.
    // checkAlternativeTitles: (searchTitle, item) => {
    //     const titles = [
    //         item.title,
    //         item.englishTitle,
    //         ...(item.alternativeTitles || [])
    //     ].filter(Boolean); // Remove null/undefined

    //     const scores = titles.map(title => ({
    //         title,
    //         score: FuzzyMatcher.getSimilarity(searchTitle, title)
    //     }));

    //     return Math.max(...scores.map(s => s.score));
    // }
};

module.exports = FuzzyMatcher;