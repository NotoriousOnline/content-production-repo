<?php
/**
 * Plugin Name: Green.org FluentCRM Latest Posts
 * Description: FluentCRM SmartCodes for the 5 most recent published posts.
 *
 * Tokens: {{green_posts.post_1_title}} {{green_posts.post_1_url}}
 *         {{green_posts.post_1_image}} {{green_posts.post_1_excerpt}}
 *         {{green_posts.post_1_category}} {{green_posts.post_1_date}}
 *         ... same for post_2 … post_5
 */

if (!function_exists('green_org_latest_posts')) {
    function green_org_latest_posts() {
        static $cache = null;
        if ($cache !== null) {
            return $cache;
        }
        $cache = get_posts([
            'post_type'           => 'post',
            'post_status'         => 'publish',
            'posts_per_page'      => 5,
            'orderby'             => 'date',
            'order'               => 'DESC',
            'ignore_sticky_posts' => true,
            'suppress_filters'    => true,
            'no_found_rows'       => true,
        ]);
        return is_array($cache) ? $cache : [];
    }
}

if (!function_exists('green_org_post_intro')) {
    function green_org_post_intro($post, $limit = 220) {
        $text = '';
        if (has_excerpt($post)) {
            $text = get_the_excerpt($post);
        } else {
            $content = strip_shortcodes((string) $post->post_content);
            $content = apply_filters('the_content', $content);
            if (preg_match('/<p[^>]*>(.*?)<\/p>/is', $content, $m)) {
                $text = wp_strip_all_tags($m[1]);
            } else {
                $text = wp_strip_all_tags($content);
            }
        }
        $text = trim(preg_replace('/\s+/', ' ', (string) $text));
        $len = function_exists('mb_strlen') ? mb_strlen($text) : strlen($text);
        if ($len > $limit) {
            $cut = function_exists('mb_substr') ? mb_substr($text, 0, $limit) : substr($text, 0, $limit);
            $text = rtrim($cut, " ,.;:-") . '…';
        }
        return $text;
    }
}

if (!function_exists('green_org_fluentcrm_smartcode_callback')) {
    function green_org_fluentcrm_smartcode_callback($code, $valueKey, $defaultValue, $subscriber) {
        $valueKey = preg_replace('/^green_posts\./', '', (string) $valueKey);
        if (!preg_match('/^post_([1-5])_(title|url|image|excerpt|category|date)$/', $valueKey, $m)) {
            return $defaultValue !== '' && $defaultValue !== null ? $defaultValue : $code;
        }

        $posts = green_org_latest_posts();
        $index = (int) $m[1] - 1;
        $field = $m[2];
        $fallbackLogo = 'https://green.org/wp-content/uploads/2022/07/Green.org-logo-2022-New.png';
        $fallbackUrl = home_url('/');

        if (empty($posts[$index]) || !($posts[$index] instanceof WP_Post)) {
            if ($field === 'url') {
                return $fallbackUrl;
            }
            if ($field === 'image') {
                return $fallbackLogo;
            }
            if ($field === 'title') {
                return 'Green.org';
            }
            if ($field === 'category') {
                return 'Green.org';
            }
            return $defaultValue !== '' && $defaultValue !== null ? $defaultValue : '';
        }

        $post = $posts[$index];

        switch ($field) {
            case 'title':
                $title = wp_strip_all_tags(get_the_title($post));
                return $title !== '' ? $title : 'Green.org';

            case 'url':
                $url = get_permalink($post);
                return $url ? $url : $fallbackUrl;

            case 'image':
                $img = get_the_post_thumbnail_url($post, 'large');
                return $img ? $img : $fallbackLogo;

            case 'excerpt':
                return green_org_post_intro($post);

            case 'category':
                $terms = get_the_terms($post, 'category');
                return ($terms && !is_wp_error($terms) && !empty($terms[0]->name)) ? $terms[0]->name : 'Green.org';

            case 'date':
                return get_the_date(get_option('date_format'), $post);
        }

        return $defaultValue !== '' && $defaultValue !== null ? $defaultValue : $code;
    }
}

$green_org_register_fluentcrm_codes = static function () {
    static $registered = false;
    if ($registered) {
        return;
    }

    $shortcodes = [];
    for ($i = 1; $i <= 5; $i++) {
        $shortcodes["post_{$i}_title"]    = "Post {$i} title";
        $shortcodes["post_{$i}_url"]      = "Post {$i} permalink";
        $shortcodes["post_{$i}_image"]    = "Post {$i} featured image URL";
        $shortcodes["post_{$i}_excerpt"]  = "Post {$i} first paragraph / excerpt";
        $shortcodes["post_{$i}_category"] = "Post {$i} primary category";
        $shortcodes["post_{$i}_date"]     = "Post {$i} publish date";
    }

    if (function_exists('FluentCrmApi')) {
        FluentCrmApi('extender')->addSmartCode(
            'green_posts',
            'Green.org Latest Posts',
            $shortcodes,
            'green_org_fluentcrm_smartcode_callback'
        );
        $registered = true;
        return;
    }

    add_filter('fluent_crm/smartcode_group_callback_green_posts', 'green_org_fluentcrm_smartcode_callback', 10, 4);
    add_filter('fluentcrm_smartcode_group_callback_green_posts', 'green_org_fluentcrm_smartcode_callback', 10, 4);
    $registered = true;
};

add_action('fluent_crm/after_init', $green_org_register_fluentcrm_codes, 20);
add_action('init', $green_org_register_fluentcrm_codes, 30);
