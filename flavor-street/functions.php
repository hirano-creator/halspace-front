<?php
/**
 * Flavor Street テーマ functions
 *
 * @package FlavorStreet
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'FS_VERSION', '1.0.0' );
define( 'FS_DIR', get_template_directory() );
define( 'FS_URI', get_template_directory_uri() );

/**
 * テーマセットアップ
 */
function flavor_street_setup() {
	add_theme_support( 'title-tag' );
	add_theme_support( 'post-thumbnails' );
	add_theme_support( 'custom-logo', array(
		'height'      => 60,
		'width'       => 200,
		'flex-height' => true,
		'flex-width'  => true,
	) );
	add_theme_support( 'html5', array(
		'search-form',
		'comment-form',
		'comment-list',
		'gallery',
		'caption',
		'style',
		'script',
	) );
	add_theme_support( 'responsive-embeds' );
	add_theme_support( 'editor-styles' );

	// アイキャッチ画像サイズ
	add_image_size( 'fs-hero', 1920, 1080, true );
	add_image_size( 'fs-card', 600, 400, true );
	add_image_size( 'fs-gallery', 800, 600, true );
	add_image_size( 'fs-thumbnail', 400, 300, true );

	// ナビゲーションメニュー
	register_nav_menus( array(
		'primary'    => 'メインメニュー',
		'footer'     => 'フッターメニュー',
		'mobile'     => 'モバイルメニュー',
	) );
}
add_action( 'after_setup_theme', 'flavor_street_setup' );

/**
 * スタイル・スクリプト読み込み
 */
function flavor_street_scripts() {
	// Google Fonts
	wp_enqueue_style(
		'fs-google-fonts',
		'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&family=Poppins:wght@400;500;600;700&display=swap',
		array(),
		null
	);

	// テーマスタイル
	wp_enqueue_style( 'fs-style', get_stylesheet_uri(), array(), FS_VERSION );
	wp_enqueue_style( 'fs-custom', FS_URI . '/assets/css/custom.css', array( 'fs-style' ), FS_VERSION );

	// JavaScript
	wp_enqueue_script( 'fs-main', FS_URI . '/assets/js/main.js', array(), FS_VERSION, true );

	// ローカライズ（AJAX URL等）
	wp_localize_script( 'fs-main', 'fsData', array(
		'ajaxUrl' => admin_url( 'admin-ajax.php' ),
		'nonce'   => wp_create_nonce( 'fs_nonce' ),
		'siteUrl' => home_url( '/' ),
	) );
}
add_action( 'wp_enqueue_scripts', 'flavor_street_scripts' );

/**
 * カスタマイザー設定
 */
function flavor_street_customizer( $wp_customize ) {

	// ============================
	// ヒーローセクション
	// ============================
	$wp_customize->add_section( 'fs_hero', array(
		'title'    => 'ヒーローセクション',
		'priority' => 30,
	) );

	// ヒーロー背景画像
	$wp_customize->add_setting( 'fs_hero_bg', array( 'sanitize_callback' => 'esc_url_raw' ) );
	$wp_customize->add_control( new WP_Customize_Image_Control( $wp_customize, 'fs_hero_bg', array(
		'label'   => 'ヒーロー背景画像',
		'section' => 'fs_hero',
	) ) );

	// ヒーロー背景動画
	$wp_customize->add_setting( 'fs_hero_video', array( 'sanitize_callback' => 'esc_url_raw' ) );
	$wp_customize->add_control( new WP_Customize_Upload_Control( $wp_customize, 'fs_hero_video', array(
		'label'       => 'ヒーロー背景動画（MP4）',
		'description' => '動画を設定すると背景画像の代わりに表示されます',
		'section'     => 'fs_hero',
		'mime_type'   => 'video',
	) ) );

	// メインタイトル
	$wp_customize->add_setting( 'fs_hero_title', array(
		'default'           => 'キッチンカーの出展・誘致なら',
		'sanitize_callback' => 'sanitize_text_field',
	) );
	$wp_customize->add_control( 'fs_hero_title', array(
		'label'   => 'メインタイトル',
		'section' => 'fs_hero',
		'type'    => 'text',
	) );

	// サブタイトル
	$wp_customize->add_setting( 'fs_hero_subtitle', array(
		'default'           => '全国のキッチンカーと出展場所をつなぐプラットフォーム',
		'sanitize_callback' => 'sanitize_text_field',
	) );
	$wp_customize->add_control( 'fs_hero_subtitle', array(
		'label'   => 'サブタイトル',
		'section' => 'fs_hero',
		'type'    => 'textarea',
	) );

	// ============================
	// 実績セクション
	// ============================
	$wp_customize->add_section( 'fs_traction', array(
		'title'    => '実績数値',
		'priority' => 35,
	) );

	$traction_items = array(
		array( 'key' => 'locations', 'label' => '出展場所数', 'default_num' => '500', 'default_unit' => 'ヶ所以上' ),
		array( 'key' => 'shops',     'label' => '登録店舗数', 'default_num' => '1,000', 'default_unit' => '店以上' ),
		array( 'key' => 'events',    'label' => 'イベント実績', 'default_num' => '300', 'default_unit' => '件以上' ),
		array( 'key' => 'satisfaction', 'label' => '満足度', 'default_num' => '95', 'default_unit' => '%' ),
	);

	foreach ( $traction_items as $item ) {
		$wp_customize->add_setting( "fs_traction_{$item['key']}_num", array(
			'default'           => $item['default_num'],
			'sanitize_callback' => 'sanitize_text_field',
		) );
		$wp_customize->add_control( "fs_traction_{$item['key']}_num", array(
			'label'   => "{$item['label']}（数値）",
			'section' => 'fs_traction',
			'type'    => 'text',
		) );

		$wp_customize->add_setting( "fs_traction_{$item['key']}_unit", array(
			'default'           => $item['default_unit'],
			'sanitize_callback' => 'sanitize_text_field',
		) );
		$wp_customize->add_control( "fs_traction_{$item['key']}_unit", array(
			'label'   => "{$item['label']}（単位）",
			'section' => 'fs_traction',
			'type'    => 'text',
		) );
	}

	// ============================
	// サービスカード画像
	// ============================
	$wp_customize->add_section( 'fs_service_images', array(
		'title'       => 'サービスカード画像',
		'description' => '各サービスカードの画像をここで設定できます',
		'priority'    => 37,
	) );

	$service_cards = array(
		'exhibit'  => 'キッチンカーで出展したい',
		'start'    => 'キッチンカーを始めたい',
		'invite'   => 'キッチンカーを呼びたい',
		'event'    => 'イベントに呼びたい',
	);

	foreach ( $service_cards as $key => $label ) {
		$wp_customize->add_setting( "fs_service_img_{$key}", array( 'sanitize_callback' => 'esc_url_raw' ) );
		$wp_customize->add_control( new WP_Customize_Image_Control( $wp_customize, "fs_service_img_{$key}", array(
			'label'   => "{$label} - 画像",
			'section' => 'fs_service_images',
		) ) );
	}

	// ============================
	// 実績ギャラリー
	// ============================
	$wp_customize->add_section( 'fs_gallery', array(
		'title'       => '実績ギャラリー',
		'description' => '実績セクションに表示する画像（最大6枚）',
		'priority'    => 40,
	) );

	for ( $i = 1; $i <= 6; $i++ ) {
		$wp_customize->add_setting( "fs_gallery_img_{$i}", array( 'sanitize_callback' => 'esc_url_raw' ) );
		$wp_customize->add_control( new WP_Customize_Image_Control( $wp_customize, "fs_gallery_img_{$i}", array(
			'label'   => "ギャラリー画像 {$i}",
			'section' => 'fs_gallery',
		) ) );

		$wp_customize->add_setting( "fs_gallery_caption_{$i}", array(
			'default'           => '',
			'sanitize_callback' => 'sanitize_text_field',
		) );
		$wp_customize->add_control( "fs_gallery_caption_{$i}", array(
			'label'   => "キャプション {$i}",
			'section' => 'fs_gallery',
			'type'    => 'text',
		) );
	}

	// ============================
	// CTA セクション
	// ============================
	$wp_customize->add_section( 'fs_cta', array(
		'title'    => 'CTAセクション',
		'priority' => 45,
	) );

	$wp_customize->add_setting( 'fs_cta_bg', array( 'sanitize_callback' => 'esc_url_raw' ) );
	$wp_customize->add_control( new WP_Customize_Image_Control( $wp_customize, 'fs_cta_bg', array(
		'label'   => 'CTA背景画像',
		'section' => 'fs_cta',
	) ) );

	// ============================
	// SNS リンク
	// ============================
	$wp_customize->add_section( 'fs_social', array(
		'title'    => 'SNSリンク',
		'priority' => 50,
	) );

	$socials = array( 'twitter' => 'X (Twitter)', 'instagram' => 'Instagram', 'facebook' => 'Facebook', 'line' => 'LINE', 'youtube' => 'YouTube' );
	foreach ( $socials as $key => $label ) {
		$wp_customize->add_setting( "fs_social_{$key}", array(
			'default'           => '',
			'sanitize_callback' => 'esc_url_raw',
		) );
		$wp_customize->add_control( "fs_social_{$key}", array(
			'label'   => "{$label} URL",
			'section' => 'fs_social',
			'type'    => 'url',
		) );
	}
}
add_action( 'customize_register', 'flavor_street_customizer' );

/**
 * カスタム投稿タイプ：実績
 */
function flavor_street_register_post_types() {
	register_post_type( 'fs_case', array(
		'labels' => array(
			'name'          => '実績',
			'singular_name' => '実績',
			'add_new_item'  => '新しい実績を追加',
			'edit_item'     => '実績を編集',
		),
		'public'       => true,
		'has_archive'  => true,
		'rewrite'      => array( 'slug' => 'cases' ),
		'menu_icon'    => 'dashicons-awards',
		'supports'     => array( 'title', 'editor', 'thumbnail', 'excerpt' ),
		'show_in_rest' => true,
	) );

	register_post_type( 'fs_news', array(
		'labels' => array(
			'name'          => 'ニュース',
			'singular_name' => 'ニュース',
			'add_new_item'  => '新しいニュースを追加',
			'edit_item'     => 'ニュースを編集',
		),
		'public'       => true,
		'has_archive'  => true,
		'rewrite'      => array( 'slug' => 'news' ),
		'menu_icon'    => 'dashicons-megaphone',
		'supports'     => array( 'title', 'editor', 'thumbnail', 'excerpt' ),
		'show_in_rest' => true,
	) );
}
add_action( 'init', 'flavor_street_register_post_types' );

/**
 * カスタムタクソノミー
 */
function flavor_street_register_taxonomies() {
	register_taxonomy( 'fs_case_area', 'fs_case', array(
		'labels' => array(
			'name'          => 'エリア',
			'singular_name' => 'エリア',
		),
		'public'       => true,
		'hierarchical' => true,
		'rewrite'      => array( 'slug' => 'area' ),
		'show_in_rest' => true,
	) );

	register_taxonomy( 'fs_news_cat', 'fs_news', array(
		'labels' => array(
			'name'          => 'ニュースカテゴリ',
			'singular_name' => 'ニュースカテゴリ',
		),
		'public'       => true,
		'hierarchical' => true,
		'show_in_rest' => true,
	) );
}
add_action( 'init', 'flavor_street_register_taxonomies' );

/**
 * ウィジェットエリア
 */
function flavor_street_widgets_init() {
	register_sidebar( array(
		'name'          => 'フッターウィジェット 1',
		'id'            => 'footer-1',
		'before_widget' => '<div class="fs-footer-widget">',
		'after_widget'  => '</div>',
		'before_title'  => '<h4 class="fs-footer-widget__title">',
		'after_title'   => '</h4>',
	) );

	register_sidebar( array(
		'name'          => 'フッターウィジェット 2',
		'id'            => 'footer-2',
		'before_widget' => '<div class="fs-footer-widget">',
		'after_widget'  => '</div>',
		'before_title'  => '<h4 class="fs-footer-widget__title">',
		'after_title'   => '</h4>',
	) );
}
add_action( 'widgets_init', 'flavor_street_widgets_init' );

/**
 * プレースホルダー画像生成ヘルパー
 */
function fs_placeholder_img( $width = 800, $height = 600, $text = '' ) {
	$text = $text ?: "{$width}x{$height}";
	return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='{$width}' height='{$height}'%3E%3Crect fill='%23E9ECEF' width='100%25' height='100%25'/%3E%3Ctext fill='%236C757D' font-family='sans-serif' font-size='20' x='50%25' y='50%25' text-anchor='middle' dy='.3em'%3E{$text}%3C/text%3E%3C/svg%3E";
}

/**
 * カスタマイザー画像取得ヘルパー（プレースホルダー付き）
 */
function fs_get_image( $setting_key, $fallback_width = 800, $fallback_height = 600, $fallback_text = '' ) {
	$img = get_theme_mod( $setting_key );
	return $img ? esc_url( $img ) : fs_placeholder_img( $fallback_width, $fallback_height, $fallback_text );
}
